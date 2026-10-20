import { describe, expect, it } from "vitest";

import { parseVideoLink } from "./video";

describe("parseVideoLink (ADR-034)", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "youtube", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "youtube", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"],
    ["https://vimeo.com/76979871", "vimeo", "76979871"],
    ["https://player.vimeo.com/video/76979871?h=x", "vimeo", "76979871"],
  ])("%s", (link, provider, id) => {
    expect(parseVideoLink(link)).toEqual({ provider, id });
  });

  it.each([
    "https://evil.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=<script>",
    "https://vimeo.com/channels/staffpicks",
    "no es un enlace",
  ])("rechaza %s", (link) => {
    expect(parseVideoLink(link)).toBeNull();
  });
});
