import { useEffect, useState } from "react";

/** Current hash route split into segments, e.g. "#/grade/a/q/ans" -> ["grade", "a", "q", "ans"]. */
export function useHashRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return parts;
}

export function href(...parts: string[]): string {
  return `#/${parts.map(encodeURIComponent).join("/")}`;
}

export function go(...parts: string[]) {
  location.hash = href(...parts);
}
