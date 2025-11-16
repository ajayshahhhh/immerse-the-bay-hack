import { Observer, Scene, TransformNode } from "@babylonjs/core";
import { AdvancedDynamicTexture, Image } from "@babylonjs/gui";
import { z } from "zod";

import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { InputModeManager, InputMode } from "../general/InputModeManager";

export class CrosshairManager extends BaseSingletonBehavior<TransformNode> {
  public name = "CrosshairManager";
  public static argsSchema = z.object({
    hipfireImageUrl: z.string().url().describe("URL to the crosshair image file when not aiming down sights.")
  }).describe(JSON.stringify({
    summary: "A singleton crosshair manager that displays a crosshair image in the center of the screen. Shows the crosshair only when InputModeManager is in GAMEPLAY mode, automatically hiding it during UI interactions, dialogue, or other input modes. Uses fullscreen GUI overlay for pixel-perfect crosshair positioning.",
    whenToAttach: "Must be used when crosshair functionality is desired for first-person or third-person gameplay. Required for games with aiming or shooting mechanics.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Requires InputModeManager to exist.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  public static instance: CrosshairManager | null = null;

  private hipfireImageUrl: string;
  private crosshairImage: Image | null = null;
  private fullscreenGUI: AdvancedDynamicTexture | null = null;

  constructor(args: unknown) {
    super();
    const validatedArgs = CrosshairManager.argsSchema.parse(args);
    this.hipfireImageUrl = validatedArgs.hipfireImageUrl;
  }

  public loadData(): void {}

  protected onAwake(): void {}

  protected onStart(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }

    this.createCrosshair();

    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      this.updateCrosshairVisibility();
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
    if (this.fullscreenGUI) {
      this.fullscreenGUI.dispose();
      this.fullscreenGUI = null;
    }
    this.crosshairImage = null;
    CrosshairManager.instance = null;
  }

  private createCrosshair(): void {
    // Create fullscreen GUI
    this.fullscreenGUI = AdvancedDynamicTexture.CreateFullscreenUI("CrosshairSystemUI");

    this.fullscreenGUI.idealWidth = 1920;
    this.fullscreenGUI.idealHeight = 1080;

    // Create crosshair image
    this.crosshairImage = new Image("crosshairImage");

    // Center the crosshair
    this.crosshairImage.horizontalAlignment = Image.HORIZONTAL_ALIGNMENT_CENTER;
    this.crosshairImage.verticalAlignment = Image.VERTICAL_ALIGNMENT_CENTER;

    // Create image element manually with proper CORS settings
    const domImg = new window.Image();
    domImg.crossOrigin = "anonymous";

    // Load the image first, then assign it
    domImg.onload = () => {
      if (this.crosshairImage) {
        this.crosshairImage.source = domImg.src;
        this.crosshairImage.domImage = domImg;
        this.crosshairImage.widthInPixels = domImg.naturalWidth;
        this.crosshairImage.heightInPixels = domImg.naturalHeight;
      }
    };
    domImg.src = this.hipfireImageUrl;

    this.fullscreenGUI.addControl(this.crosshairImage);

    // Hide by default
    this.crosshairImage.isVisible = false;
  }

  private updateCrosshairVisibility(): void {
    if (!InputModeManager.instance) {
      throw new Error("InputModeManager instance not found");
    }
    if (!this.crosshairImage) {
      throw new Error("Crosshair image is null");
    }

    this.crosshairImage.isVisible = InputModeManager.instance.getCurrentMode() === InputMode.GAMEPLAY;
  }
}
