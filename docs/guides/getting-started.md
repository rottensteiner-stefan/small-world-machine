# Getting Started

Small World Machine is a lightweight, high-performance, modular 3D game engine for the web, built with TypeScript.

## Installation

The engine is not yet published to the npm registry. Clone the repository and install dependencies locally, then import the engine package (`@small-world-machine/engine`) from within the workspace:

```bash
git clone https://github.com/rottensteiner-stefan/small-world-machine.git
cd small-world-machine
npm install
```

## Basic setup

The engine uses a strategy-based lifecycle. You derive from `SmallWorldMachine` (or from `AbstractShowcase`, which adds a few demo/debugging conveniences on top of `SmallWorldMachine`) and override the `setupScene` and `update` lifecycle methods.

### 1. Basic showcase implementation

The page needs a canvas with the engine's default id: `<canvas id="SmallWorldMachine"></canvas>` (override via the `canvasId` option); otherwise `start()` throws "Canvas element with ID ... not found".

Create a file called `app.ts` to bootstrap the engine:

```typescript
import {
  AbstractShowcase,
  Color,
  Cube,
  Object3D,
  RendererType,
  StandardMaterial,
} from "@small-world-machine/engine";

class MyFirstWorld extends AbstractShowcase {
  protected override async setupScene(): Promise<void> {
    // 1. Create a green PBR cube
    const cubeObj = new Object3D("RotatingCube");
    cubeObj.geometry = new Cube({ size: 1.5 }).getGeometryData();
    cubeObj.material = new StandardMaterial({
      color: Color.GREEN,
      metallic: 0.5,
      roughness: 0.3,
    });
    cubeObj.position.set(0, 1.0, 0);

    // 2. Add it to the scene
    this.scene.add(cubeObj);

    // 3. Move the camera back to see the scene
    this.camera.position.set(0, 3.0, 6.0);
    this.camera.target.set(0, 1.0, 0);
  }

  protected override update(deltaTime: number): void {
    super.update(deltaTime);

    // Rotate the cube object
    const cube = this.scene.getObjectByName("RotatingCube");
    if (cube) {
      cube.rotation.y += 1.0 * deltaTime;
    }
  }
}

// Instantiate and start
const app = new MyFirstWorld({
  rendererType: RendererType.BEST,
});

app.start().then(() => {
  console.log("Small World Machine initialized!");
});
```

### 2. SPA & framework integration (React / Vue / Angular)

When Small World Machine is embedded in a single-page application (SPA), the browser doesn't automatically refresh on route changes. To prevent memory leaks or multiple render loops running concurrently in the background, the engine must be cleanly destroyed when its host component unmounts.

Simply call the `destroy()` method. This immediately stops the `requestAnimationFrame` loop, removes all global window event listeners, and frees WebGPU/WebGL memory.

```tsx
import { useEffect, useRef } from "react";
import { MyFirstWorld } from "./MyFirstWorld";

export function GameComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let app: MyFirstWorld | null = null;
    
    if (canvasRef.current) {
      app = new MyFirstWorld({
        canvasId: "SmallWorldMachineCanvas"
      });
      app.start();
    }

    return () => {
      // Fully clean up the engine when the React component unmounts!
      if (app) {
        app.destroy();
      }
    };
  }, []);

  return <canvas id="SmallWorldMachineCanvas" ref={canvasRef} />;
}
```

*Note: The engine already has an automatic safety net built in. If it detects that its canvas element was forcibly removed from the DOM by a framework without `destroy()` being called explicitly, it catches that and safely destroys itself!*
