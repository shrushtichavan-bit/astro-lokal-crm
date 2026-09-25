/** "24 Sep, 3:00 PM" in the viewer's local time — used for reschedule slots. */
export function fmtSlot(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = d.toLocaleString("en-GB", { month: "short" });
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month}, ${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}
