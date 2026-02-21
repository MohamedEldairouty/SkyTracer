import Navbar from "./Navbar";

export default function Layout({ children }) {
  return (
    <div className="min-h-screen bg-[#0b1020] text-white">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-6">{children}</div>
    </div>
  );
}
