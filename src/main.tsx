import { Engine } from "@babylonjs/core";

import * as behaviors from "./behaviors";
import MoonlakeGameSdk, { loadAllStandardPropertyModules } from "@moonlakeai/game-sdk";
import { initializePlayMode } from "./initializePlayMode";

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;

const engine = new Engine(canvas, true, {});
engine.disableUniformBuffers = true;

// Handle WebGL context loss - critical for iOS Safari and low-memory devices
canvas.addEventListener("webglcontextlost", (event) => {
  console.warn("WebGL context lost. Attempting to restore...");
  event.preventDefault();
}, false);

canvas.addEventListener("webglcontextrestored", () => {
  console.log("WebGL context restored. Reloading page...");
  // Reload the page to reinitialize everything
  window.location.reload();
}, false);

const propertyModules = await loadAllStandardPropertyModules();

const entitiesJson = await import("./entities.json").then(module => {
  return module.default || module;
});
const propertiesJson = await import("./properties.json").then(module => {
  return module.default || module;
});
const prefabLibraryJson = await import("./prefabLibrary.json").then(module => {
  return module.default || module;
});
let renderStyleJson = await import("./renderStyle.json").then(module => {
  return module.default || module;
});

// Override with onboarding preset if available (first time only)
try {
  const renderStylePreset = sessionStorage.getItem("renderStylePreset");
  if (renderStylePreset) {
    renderStyleJson = JSON.parse(renderStylePreset);
    sessionStorage.removeItem("renderStylePreset");
    console.log("Applied renderStyle preset from onboarding:", renderStyleJson);
  }
} catch (error) {
  console.warn("Failed to apply renderStyle preset:", error);
}
const dialogueJson = await import("./dialogue.json").then(module => {
  return module.default || module;
});
const itemsJson = await import("./items.json").then(module => {
  return module.default || module;
});

new MoonlakeGameSdk(engine, initializePlayMode, canvas, behaviors, propertyModules, entitiesJson, propertiesJson, prefabLibraryJson, renderStyleJson, dialogueJson, itemsJson);
