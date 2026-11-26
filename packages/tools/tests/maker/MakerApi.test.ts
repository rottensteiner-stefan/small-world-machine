import { describe, it, expect, vi } from "vitest";
import { Object3D, Vector3D } from "@small-world-machine/engine";
import { MakerApi, DEFAULT_CHARACTER_LINEUP } from "../../src/maker/MakerApi.js";
import type { MakerApp } from "../../src/maker/MakerApp.js";

describe("MakerApi", () => {
  it("exposes default character lineup constants", () => {
    expect(DEFAULT_CHARACTER_LINEUP.length).toBe(3);
    expect(DEFAULT_CHARACTER_LINEUP.map((c) => c.name)).toEqual([
      "Player Male",
      "Player Female",
      "SpaceGirl",
    ]);
  });

  it("provides selection and scene query helpers", () => {
    const fakeSceneRoot = new Object3D("Root");
    const userObj1 = new Object3D("UserObject1");
    const userObj2 = new Object3D("UserObject2");
    fakeSceneRoot.add(userObj1);
    fakeSceneRoot.add(userObj2);

    let selected: Object3D | undefined;
    const fakeApp = {
      scene: { root: fakeSceneRoot, children: fakeSceneRoot.children },
      camera: {},
      selection: new Set<Object3D>(),
      primary: undefined,
      isEditorHelper: () => false,
      selectObject: (obj: Object3D | undefined) => {
        selected = obj;
      },
      orbit: {
        target: new Vector3D(0, 0, 0),
        setView: vi.fn(),
      },
    } as unknown as MakerApp;

    const api = new MakerApi(fakeApp);

    const userObjs = api.getUserObjects();
    expect(userObjs.length).toBe(2);
    expect(userObjs).toContain(userObj1);
    expect(userObjs).toContain(userObj2);

    // Test selection by name
    api.select("UserObject2");
    expect(selected).toBe(userObj2);

    // Test deselect
    api.deselect();
    expect(selected).toBeUndefined();
  });
});
