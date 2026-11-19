import { describe, expect, it } from "vitest";
import { normalizeBackendUrl } from "@/server/integrations/backend";

describe("intelligence backend URL", () => {
  it("accepts full URLs and Render's bare internal host names", () => {
    expect(normalizeBackendUrl("https://twin-backend.onrender.com/")).toBe("https://twin-backend.onrender.com");
    expect(normalizeBackendUrl("http://localhost:8000")).toBe("http://localhost:8000");
    expect(normalizeBackendUrl("twin-backend-ab12")).toBe("http://twin-backend-ab12:8000");
    expect(normalizeBackendUrl("twin-backend-ab12:9000")).toBe("http://twin-backend-ab12:9000");
    expect(normalizeBackendUrl("")).toBe("");
  });
});
