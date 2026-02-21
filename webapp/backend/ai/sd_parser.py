import re
from datetime import datetime
from typing import List, Dict, Optional

# Payload log blocks look like:
# Date (LOCAL):    20/12/2025
# Time (LOCAL):    11:29:17 PM
# IAQ:             178.4
# Gas (kΩ):        12.34
# Temp (main, C):  25.12
# Humidity (%):    55.1
# Pressure (hPa):  1013.2
# Latitude:        31.123456
# Longitude:       29.987654
# Altitude (m):    12.3

KEYS = {
    "date": re.compile(r"Date\s*\(LOCAL\):\s*(.+)"),
    "time": re.compile(r"Time\s*\(LOCAL\):\s*(.+)"),
    "iaq": re.compile(r"IAQ:\s*([-\d.]+)"),
    "gasK": re.compile(r"Gas\s*\(kΩ\):\s*([-\d.]+)"),
    "temp": re.compile(r"Temp\s*\(main,\s*C\):\s*([-\d.]+)"),
    "hum": re.compile(r"Humidity\s*\(%\):\s*([-\d.]+)"),
    "pres": re.compile(r"Pressure\s*\(hPa\):\s*([-\d.]+)"),
    "lat": re.compile(r"Latitude:\s*([-\d.]+)"),
    "lon": re.compile(r"Longitude:\s*([-\d.]+)"),
    "alt": re.compile(r"Altitude\s*\(m\):\s*([-\d.]+)"),
}

def _to_float(s: Optional[str]) -> Optional[float]:
    try:
        if s is None: return None
        v = float(s)
        if v != v:  # NaN
            return None
        return v
    except:
        return None

def _parse_dt(date_str: str, time_str: str) -> Optional[datetime]:
    # date: dd/mm/yyyy
    # time: hh:mm:ss AM/PM
    try:
        dt = datetime.strptime(f"{date_str} {time_str}", "%d/%m/%Y %I:%M:%S %p")
        return dt
    except:
        return None

def parse_payload_log(path: str) -> List[Dict]:
    items = []
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            block = []
            for line in f:
                line = line.strip("\n")
                if line.strip() == "----------------------------------------":
                    # flush previous block if any
                    if block:
                        items.extend(_parse_block(block))
                        block = []
                else:
                    block.append(line)
            if block:
                items.extend(_parse_block(block))
    except FileNotFoundError:
        return []
    return items

def _parse_block(lines: List[str]) -> List[Dict]:
    # extract one entry
    text = "\n".join(lines)
    def m(key):
        mm = KEYS[key].search(text)
        return mm.group(1).strip() if mm else None

    date_str = m("date")
    time_str = m("time")

    if not date_str or not time_str:
        return []

    dt = _parse_dt(date_str, time_str)
    if not dt:
        return []

    doc = {
        "source": "SD",
        "createdAt": dt.isoformat(),  # local ISO string; backend will treat as string unless you convert
        "date": date_str,
        "time": time_str,
        "iaq": _to_float(m("iaq")),
        "gasK": _to_float(m("gasK")),
        "temp": _to_float(m("temp")),
        "hum": _to_float(m("hum")),
        "pres": _to_float(m("pres")),
        "lat": _to_float(m("lat")),
        "lon": _to_float(m("lon")),
        "alt": _to_float(m("alt")),
    }
    # keep only blocks that have IAQ
    if doc["iaq"] is None:
        return []
    return [doc]
