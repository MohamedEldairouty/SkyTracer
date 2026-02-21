# ai/train_ai.py
# ============================================================
# SkyTracer AI Trainer
# - Forecast IAQ in the near future (regression)
# - Predict hazard probability IAQ >= threshold (classification)
# - Saves model.json for backend to serve
# ============================================================

import os
import json
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.metrics import mean_absolute_error, roc_auc_score

try:
    from pymongo import MongoClient
except ImportError:
    raise SystemExit("❌ Missing dependency: pymongo. Install: pip install pymongo")

# ---------------------------
# Config (tweak as needed)
# ---------------------------
HORIZON_STEPS = int(os.getenv("AI_HORIZON_STEPS", "40"))     # future steps (payload ~3s each)
ROLL = int(os.getenv("AI_ROLL", "10"))                       # rolling window size
HAZARD_THRESHOLD = float(os.getenv("AI_HAZARD_THRESHOLD", "200"))
SAMPLE_INTERVAL_SEC = int(os.getenv("AI_SAMPLE_INTERVAL_SEC", "3"))

# Mongo config (set in backend/.env)
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017")
DB_NAME = os.getenv("DB_NAME", "skytracer")                  # change if your DB name differs
COLLECTION = os.getenv("TELEMETRY_COLLECTION", "telemetries")  # typical mongoose pluralization

# Save path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))              # .../backend/ai
MODEL_PATH = os.path.join(BASE_DIR, "model.json")


# ============================================================
# Helpers
# ============================================================

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def is_finite(x) -> bool:
    try:
        return math.isfinite(float(x))
    except Exception:
        return False


def clean_numeric_series(s: pd.Series) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    s = s.replace([np.inf, -np.inf], np.nan)
    return s


def load_from_mongo() -> pd.DataFrame:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
    db = client[DB_NAME]
    col = db[COLLECTION]

    # Pull minimal fields for training
    cursor = col.find(
        {},
        {
            "_id": 0,
            "createdAt": 1,
            "iaq": 1,
            "gasK": 1,
            "temp": 1,
            "hum": 1,
            "pres": 1,
        },
    ).sort("createdAt", 1)

    rows = list(cursor)
    if not rows:
        raise RuntimeError(f"❌ No telemetry documents found in MongoDB: {DB_NAME}.{COLLECTION}")

    df = pd.DataFrame(rows)

    # Ensure createdAt is datetime
    df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce", utc=True)

    # Clean numeric fields
    for colname in ["iaq", "gasK", "temp", "hum", "pres"]:
        if colname not in df.columns:
            df[colname] = np.nan
        df[colname] = clean_numeric_series(df[colname])

    # Sort & drop junk
    df = df.sort_values("createdAt").reset_index(drop=True)
    df = df.dropna(subset=["createdAt", "iaq"])  # must have IAQ + timestamp

    # Optional: clip impossible IAQ values if your stream sometimes sends garbage
    df = df[(df["iaq"] >= 0) & (df["iaq"] <= 600)].reset_index(drop=True)

    return df


def load_from_csv(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)

    # Accept either createdAt ISO or separate date/time; we prefer createdAt if present
    if "createdAt" in df.columns:
        df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce", utc=True)
    else:
        # fallback if you have date+time columns in csv
        if "date" in df.columns and "time" in df.columns:
            df["createdAt"] = pd.to_datetime(df["date"].astype(str) + " " + df["time"].astype(str), errors="coerce", utc=True)
        else:
            raise RuntimeError("CSV must include 'createdAt' or ('date' and 'time').")

    for colname in ["iaq", "gasK", "temp", "hum", "pres"]:
        if colname not in df.columns:
            df[colname] = np.nan
        df[colname] = clean_numeric_series(df[colname])

    df = df.sort_values("createdAt").reset_index(drop=True)
    df = df.dropna(subset=["createdAt", "iaq"]).reset_index(drop=True)
    df = df[(df["iaq"] >= 0) & (df["iaq"] <= 600)].reset_index(drop=True)
    return df


def build_features(df: pd.DataFrame, roll: int) -> pd.DataFrame:
    """
    Create features similar to what you printed:
      - raw: iaq, gasK, temp, hum, pres
      - deltas: iaq_d1, gas_d1, pres_d1
      - rolling mean: iaq_mean, gas_mean, pres_mean
      - rolling std: iaq_std, gas_std
    """
    out = df.copy()

    out["iaq_d1"] = out["iaq"].diff(1)
    out["gas_d1"] = out["gasK"].diff(1)
    out["pres_d1"] = out["pres"].diff(1)

    out["iaq_mean"] = out["iaq"].rolling(roll).mean()
    out["gas_mean"] = out["gasK"].rolling(roll).mean()
    out["pres_mean"] = out["pres"].rolling(roll).mean()

    out["iaq_std"] = out["iaq"].rolling(roll).std()
    out["gas_std"] = out["gasK"].rolling(roll).std()

    # fill missing values (start of stream)
    out = out.replace([np.inf, -np.inf], np.nan)
    out = out.dropna().reset_index(drop=True)
    return out


def make_supervised(df_feat: pd.DataFrame, horizon_steps: int, hazard_threshold: float):
    """
    Target regression: future_iaq = iaq shifted by -horizon_steps
    Target classification: hazard = future_iaq >= threshold
    """
    df = df_feat.copy()
    df["iaq_future"] = df["iaq"].shift(-horizon_steps)

    # drop last horizon steps (no label)
    df = df.dropna(subset=["iaq_future"]).reset_index(drop=True)

    df["hazard"] = (df["iaq_future"] >= hazard_threshold).astype(int)

    return df


def time_split(df: pd.DataFrame, test_ratio: float = 0.2):
    """
    Time-based split (no shuffling)
    """
    n = len(df)
    n_test = int(n * test_ratio)
    n_train = n - n_test
    train = df.iloc[:n_train].reset_index(drop=True)
    test = df.iloc[n_train:].reset_index(drop=True)
    return train, test


# ============================================================
# Training
# ============================================================

def train(df_raw: pd.DataFrame):
    # Build features
    df_feat = build_features(df_raw, ROLL)

    # Build supervised dataset
    df_sup = make_supervised(df_feat, HORIZON_STEPS, HAZARD_THRESHOLD)

    # Feature list (exact names you want)
    features = [
        "iaq",
        "gasK",
        "temp",
        "hum",
        "pres",
        "iaq_d1",
        "gas_d1",
        "pres_d1",
        "iaq_mean",
        "gas_mean",
        "pres_mean",
        "iaq_std",
        "gas_std",
    ]

    # Keep only required columns and drop rows with missing
    df_sup = df_sup.dropna(subset=features + ["iaq_future", "hazard"]).reset_index(drop=True)

    # Time split
    train_df, test_df = time_split(df_sup, test_ratio=0.2)

    X_train = train_df[features].values.astype(np.float64)
    y_train_reg = train_df["iaq_future"].values.astype(np.float64)
    y_train_clf = train_df["hazard"].values.astype(np.int64)

    X_test = test_df[features].values.astype(np.float64)
    y_test_reg = test_df["iaq_future"].values.astype(np.float64)
    y_test_clf = test_df["hazard"].values.astype(np.int64)

    # Scale
    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X_train)
    X_test_s = scaler.transform(X_test)

    # Regression model (simple & strong baseline)
    reg = Ridge(alpha=1.0, random_state=42)
    reg.fit(X_train_s, y_train_reg)
    pred_reg = reg.predict(X_test_s)
    mae = mean_absolute_error(y_test_reg, pred_reg)

    # Classification model
    clf = LogisticRegression(
        max_iter=2000,
        solver="lbfgs",
        class_weight="balanced",
        random_state=42,
    )
    clf.fit(X_train_s, y_train_clf)
    prob_clf = clf.predict_proba(X_test_s)[:, 1]

    # AUC (if test has both classes)
    try:
        auc = roc_auc_score(y_test_clf, prob_clf)
    except ValueError:
        auc = float("nan")

    # Create model package to save
    model = {
        "meta": {
            "horizon_steps": HORIZON_STEPS,
            "hazard_threshold": HAZARD_THRESHOLD,
            "roll": ROLL,
            "sample_interval_sec": SAMPLE_INTERVAL_SEC,
            "features": features,
            "trained_at": utc_now_iso(),
        },
        "metrics": {
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
            "iaq_mae": float(mae),
            "hazard_auc": float(auc) if is_finite(auc) else None,
        },
        "modelBrief": {
            "name": "Ridge Regression + Logistic Hazard Classifier",
            "input": "Recent telemetry window (iaq, gasK, temp, hum, pres) + short-term trends",
            "output": f"IAQ forecast (~{HORIZON_STEPS * SAMPLE_INTERVAL_SEC}s ahead) + hazard probability (IAQ ≥ {HAZARD_THRESHOLD})",
        },
        "scaler": {
            "mean": scaler.mean_.tolist(),
            "scale": scaler.scale_.tolist(),
        },
        "regression": {
            "type": "ridge",
            "alpha": float(reg.alpha),
            "coef": reg.coef_.tolist(),
            "intercept": float(reg.intercept_),
        },
        "classifier": {
            "type": "logistic",
            "coef": clf.coef_.tolist(),      # shape (1, n_features)
            "intercept": clf.intercept_.tolist(),
            "classes": clf.classes_.tolist(),
        },
        # store a small "now" snapshot for quick sanity checks
        "now": {
            "createdAt": df_raw["createdAt"].iloc[-1].to_pydatetime().isoformat().replace("+00:00", "Z")
            if len(df_raw) else None,
            "iaq": float(df_raw["iaq"].iloc[-1]) if len(df_raw) else None,
        },
    }

    return model


def main():
    # optional: allow csv training
    csv_path = os.getenv("AI_CSV_PATH", "").strip()

    if csv_path:
        print(f"📦 Loading training data from CSV: {csv_path}")
        df = load_from_csv(csv_path)
    else:
        print(f"🗄️ Loading training data from MongoDB: {DB_NAME}.{COLLECTION}")
        df = load_from_mongo()

    if len(df) < (ROLL + HORIZON_STEPS + 50):
        raise RuntimeError(
            f"❌ Not enough data to train. Need at least ~{ROLL + HORIZON_STEPS + 50} rows, got {len(df)}."
        )

    model = train(df)

    # Print summary like yours
    print(f"✅ Train samples: {model['metrics']['train_samples']} | Test samples: {model['metrics']['test_samples']}")
    print(f"📉 IAQ forecast MAE: {model['metrics']['iaq_mae']:.2f}")
    auc = model["metrics"]["hazard_auc"]
    if auc is None:
        print("🧨 Hazard AUC: N/A (test set had one class only)")
    else:
        print(f"🧨 Hazard AUC: {auc:.3f}")

    # Save
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    with open(MODEL_PATH, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=2)

    print(f"✅ Saved model -> {MODEL_PATH}")


if __name__ == "__main__":
    main()
