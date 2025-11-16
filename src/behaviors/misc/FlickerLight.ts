import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { type PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { z } from "zod";

export class FlickerLight extends BaseBehavior<PointLight> {
  public name = "FlickerLight";
  public static argsSchema = z.object({
    baseIntensity: z.number().positive().default(0.25).describe("Base intensity of the light"),
    flickerAmount: z.number().min(0).max(1).default(0.3).describe("Amount of flicker (0-1, where 1 is maximum flicker)"),
    flickerSpeed: z.number().positive().default(10).describe("Speed of the flicker effect"),
    range: z.number().positive().default(10).describe("Maximum range of the light in units")
  }).describe(JSON.stringify({
    summary: "Creates a flickering light effect by randomly varying the light intensity over time. Simulates torch, candle, or fire-like lighting.",
    whenToAttach: "Attach to PointLight entities when you want a flickering effect like torches, candles, or fires.",
    requirementsToAttach: "Must be attached to a standard/PointLight entity.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private baseIntensity: number;
  private flickerAmount: number;
  private flickerSpeed: number;
  private range: number;
  private time: number = 0;

  constructor(args: unknown) {
    super();
    const validatedArgs = FlickerLight.argsSchema.parse(args);
    this.baseIntensity = validatedArgs.baseIntensity;
    this.flickerAmount = validatedArgs.flickerAmount;
    this.flickerSpeed = validatedArgs.flickerSpeed;
    this.range = validatedArgs.range;
  }

  protected onAwake(): void {
    // Initialize the light intensity and range now that node is initialized
    this.node.intensity = this.baseIntensity;
    this.node.range = this.range;
    
    // Ensure diffuse color is properly set (it should be set from initialization already)
    if (this.node.diffuse) {
      this.node.diffuse = this.node.diffuse.clone();
    }
    this.node.specular = new Color3(0, 0, 0); // No specular highlights for atmospheric lights
  }

  protected onStart(): void {
    // Register the update loop
    this.scene.onBeforeRenderObservable.add(() => {
      this.updateFlicker();
    });
  }

  private updateFlicker(): void {
    // Increment time
    this.time += this.scene.getEngine().getDeltaTime() / 1000;

    // Use multiple sine waves at different frequencies for a more natural flicker
    const flicker1 = Math.sin(this.time * this.flickerSpeed);
    const flicker2 = Math.sin(this.time * this.flickerSpeed * 1.7 + 1.3);
    const flicker3 = Math.sin(this.time * this.flickerSpeed * 2.3 + 2.7);
    
    // Combine the sine waves and normalize to 0-1 range
    const combinedFlicker = (flicker1 + flicker2 * 0.5 + flicker3 * 0.3) / 1.8;
    const normalizedFlicker = (combinedFlicker + 1) / 2; // Convert from -1,1 to 0,1
    
    // Apply the flicker to the intensity
    const flickerOffset = (normalizedFlicker - 0.5) * 2 * this.flickerAmount;
    this.node.intensity = this.baseIntensity * (1 + flickerOffset);
  }

  protected onDetach(): void {
    // Clean up is handled automatically by the scene
  }
}
