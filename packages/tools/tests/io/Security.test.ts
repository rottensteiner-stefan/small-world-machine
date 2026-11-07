import { describe, it, expect } from "vitest";
import { SecurityValidator } from "../../src/common/io/Security.js";

describe("SecurityValidator", () => {
  describe("sanitizePath", () => {
    it("should normalize backslashes to forward slashes", () => {
      expect(SecurityValidator.sanitizePath("foo\\bar\\baz.txt")).toBe("foo/bar/baz.txt");
    });

    it("should strip leading slashes", () => {
      expect(SecurityValidator.sanitizePath("/foo/bar.txt")).toBe("foo/bar.txt");
      expect(SecurityValidator.sanitizePath("///foo/bar.txt")).toBe("foo/bar.txt");
    });

    it("should collapse multiple slashes and dots", () => {
      expect(SecurityValidator.sanitizePath("foo//bar/./baz.txt")).toBe("foo/bar/baz.txt");
    });

    it("should resolve and remove safe parent references or traversal", () => {
      expect(SecurityValidator.sanitizePath("foo/bar/baz.txt")).toBe("foo/bar/baz.txt");
      expect(SecurityValidator.sanitizePath("foo/../baz.txt")).toBe("foo/baz.txt");
      expect(SecurityValidator.sanitizePath("../evil.txt")).toBe("evil.txt");
    });
  });

  describe("validatePath", () => {
    it("should return valid result for clean relative paths", () => {
      const res = SecurityValidator.validatePath("textures/rock.png");
      expect(res.valid).toBe(true);
    });

    it("should return invalid result for directory traversal", () => {
      const res = SecurityValidator.validatePath("../../etc/passwd");
      expect(res.valid).toBe(false);
      expect(res.reason).toBeDefined();
    });

    it("should reject absolute paths with drive letters on Windows or root slashes", () => {
      const res = SecurityValidator.validatePath("C:/Windows/System32/calc.exe");
      expect(res.valid).toBe(false);
    });
  });

  describe("validateSize", () => {
    it("should accept payloads within size limit", () => {
      const valid = SecurityValidator.validateSize(1024 * 1024, 5 * 1024 * 1024);
      expect(valid).toBe(true);
    });

    it("should reject payloads exceeding size limit", () => {
      const valid = SecurityValidator.validateSize(10 * 1024 * 1024, 5 * 1024 * 1024);
      expect(valid).toBe(false);
    });
  });

  describe("isExtensionAllowed", () => {
    it("should allow whitelisted extensions", () => {
      const whitelist = ["png", "jpg", "gltf", "bin", "json"];
      expect(SecurityValidator.isExtensionAllowed("model.gltf", whitelist)).toBe(true);
      expect(SecurityValidator.isExtensionAllowed("texture.PNG", whitelist)).toBe(true);
      expect(SecurityValidator.isExtensionAllowed("script.exe", whitelist)).toBe(false);
    });
  });
});
