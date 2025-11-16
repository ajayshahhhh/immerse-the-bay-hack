import { Engine, HavokPlugin, RecastJSPlugin, Scene, Vector3 } from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import { Inspector } from "@babylonjs/inspector";
import Recast from "recast-detour";

// @ts-expect-error This is necessary for materials to work properly, do not remove it
import * as MATERIALS from "@babylonjs/materials";

/**
 * Initializes play mode specific features.
 * Agent-accessible function for customizing play mode parameters.
 */
export async function initializePlayMode(
  engine: Engine,
  canvas: HTMLCanvasElement,
): Promise<Scene> {
  // Create scene
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // This is not changeable

  // Physics setup
  const havokInstance = await HavokPhysics();
  const havokPlugin = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);

  // necessary: https://forum.babylonjs.com/t/recast-reference-is-not-defined-from-recastjsplugin/44562/12
  // @ts-expect-error Recast constructor signature not properly typed
  const recast = await new Recast();
  const navigationPlugin = new RecastJSPlugin(recast);

  scene.metadata = {
    ...scene.metadata,
    navigationPlugin: navigationPlugin,
  };

  if (window.location.search.includes('debug')) {
    Inspector.Show(scene, {});
  }

  // Focus canvas for keyboard input
  setTimeout(() => {
    canvas.focus();
  }, 100);

  return scene;
}
