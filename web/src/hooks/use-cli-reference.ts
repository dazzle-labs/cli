import { useEffect, useState } from "react";

/** Fetch /cli-reference.txt and extract the content inside the code fence. */
export function useCliReference(): string {
  const [text, setText] = useState("");

  useEffect(() => {
    fetch("/cli-reference.txt")
      .then((r) => r.text())
      .then((raw) => {
        // Extract content between ``` fences, or use the whole thing
        const match = raw.match(/```\n?([\s\S]*?)```/);
        setText(match ? match[1].trim() : raw.trim());
      })
      .catch(() => setText("Failed to load CLI reference."));
  }, []);

  return text;
}
