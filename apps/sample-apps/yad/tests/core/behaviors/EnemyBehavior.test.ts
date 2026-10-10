import { EnemyBehavior } from "../../../core/behaviors/EnemyBehavior.js";
import { ObjectTags } from "../../../enums/ObjectTags.js";
import { Object3D } from "@small-world-machine/engine/core/Object3D.js";
import { Scene } from "@small-world-machine/engine/core/Scene.js";
import { Camera } from "@small-world-machine/engine/core/cameras/Camera.js";
import { PerspectiveProjection, Vector3D } from "@small-world-machine/engine/math/index.js";
import { Cube } from "@small-world-machine/engine/geometry/index.js";
import { BoundingBox } from "@small-world-machine/engine/physix/index.js";

function makeCamera(): Camera {
  return new Camera(new PerspectiveProjection());
}

describe("EnemyBehavior", () => {
  it("does nothing when the player is outside detectionRange", () => {
    const scene = new Scene();
    const player = makeCamera();
    player.position.set(100, 0, 0);
    const enemy = new Object3D("enemy");
    enemy.position.set(0, 0, 0);

    const behavior = new EnemyBehavior({ player, scene, speed: 6.0, detectionRange: 30.0 });
    behavior.onAttach(enemy);
    behavior.update(1.0);

    expect(enemy.position.x).toBeCloseTo(0);
    expect(enemy.position.z).toBeCloseTo(0);
  });

  it("chases the player in a straight line when within detection range but outside attack range", () => {
    const scene = new Scene();
    const player = makeCamera();
    player.position.set(10, 0, 0);
    const enemy = new Object3D("enemy");
    enemy.position.set(0, 0, 0);

    const behavior = new EnemyBehavior({ player, scene, speed: 6.0, detectionRange: 30.0 });
    behavior.onAttach(enemy);
    behavior.update(1.0);

    // 10 units away, well outside the 1.5-unit attack threshold -- moves speed*deltaTime toward the player.
    expect(enemy.position.x).toBeCloseTo(6.0, 1);
    expect(enemy.position.z).toBeCloseTo(0, 5);
  });

  it("stops advancing once within the 1.5-unit attack range", () => {
    const scene = new Scene();
    const player = makeCamera();
    player.position.set(1.0, 0, 0);
    const enemy = new Object3D("enemy");
    enemy.position.set(0, 0, 0); // distance = 1.0

    const behavior = new EnemyBehavior({ player, scene, speed: 6.0, detectionRange: 30.0 });
    behavior.onAttach(enemy);
    behavior.update(1.0);

    expect(enemy.position.x).toBeCloseTo(0);
  });

  it("gets pushed back out of a static obstacle it walks into", () => {
    const scene = new Scene();

    // A 2x2x2 wall centered at x=2 -- world bounds x:1..3, y:-1..1, z:-1..1.
    const wall = new Object3D("wall");
    wall.geometry = new Cube({ size: 2 }).getGeometryData();
    wall.position.set(2, 0, 0);
    wall.isStatic = true;
    wall.updateMatrixWorld();
    wall.computeBounds();
    scene.add(wall);
    scene.initOctrees(new BoundingBox(new Vector3D(-50, -50, -50), new Vector3D(50, 50, 50)));
    scene.updateStaticOctree();

    const player = makeCamera();
    player.position.set(100, 0, 0); // Far past the wall, so the enemy walks straight at it.
    const enemy = new Object3D("enemy");
    // y = -0.5 so the collider (offset +0.5 on Y by _resolveCollisions) sits at y=0,
    // level with the wall's own y:-1..1 span.
    enemy.position.set(0, -0.5, 0);

    const behavior = new EnemyBehavior({ player, scene, speed: 8.0, detectionRange: 200.0 });
    behavior.onAttach(enemy);
    // speed(8) * deltaTime(0.1) = 0.8 -- the enemy's collider (radius 0.5) would end up
    // spanning x:0.3..1.3, 0.3 units deep into the wall's x:1..3 face, if uncorrected.
    behavior.update(0.1);

    // Pushed back to exactly touch the wall's face (wall starts at x=1, collider radius 0.5).
    expect(enemy.position.x).toBeCloseTo(0.5, 5);
  });

  it("never moves once tagged as a dead enemy", () => {
    const scene = new Scene();
    const player = makeCamera();
    player.position.set(5, 0, 0);
    const enemy = new Object3D("enemy");
    enemy.position.set(0, 0, 0);
    enemy.tag = ObjectTags.DEAD_ENEMY;

    const behavior = new EnemyBehavior({ player, scene, speed: 6.0, detectionRange: 30.0 });
    behavior.onAttach(enemy);
    behavior.update(1.0);

    expect(enemy.position.x).toBeCloseTo(0);
  });
});
