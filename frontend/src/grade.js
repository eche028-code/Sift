export const gradeOf = (s) =>
  s >= 85 ? { label: "Strong", bar: "bg-emerald-500", text: "text-emerald-700" }
  : s >= 70 ? { label: "Moderate", bar: "bg-teal-500", text: "text-teal-700" }
  : s >= 50 ? { label: "Limited", bar: "bg-amber-500", text: "text-amber-700" }
  : { label: "Weak", bar: "bg-rose-500", text: "text-rose-700" };
