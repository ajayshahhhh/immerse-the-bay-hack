import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { type PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { z } from "zod";

export class PointLightRange extends BaseBehavior<PointLight> {
  public name = "PointLightRange";
  public static argsSchema = z.object({
    range: z.number().positive().default(10).describe("Maximum range of the light in units")
  }).describe(JSON.stringify({
    summary: "Sets the range for a point light to control how far the light reaches.",
    whenToAttach: "Attach to PointLight entities that need a specific range.",
    requirementsToAttach: "Must be attached to a standard/PointLight entity.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  private range: number;

  constructor(args: unknown) {
    super();
    const validatedArgs = PointLightRange.argsSchema.parse(args);
    this.range = validatedArgs.range;
  }

  protected onAwake(): void {
    // Set the range now that node is initialized
    this.node.range = this.range;
    
    // Ensure diffuse color is properly set (it should be set from initialization already)
    // But we need to make sure it's cloned so modifications work
    if (this.node.diffuse) {
      this.node.diffuse = this.node.diffuse.clone();
    }
    this.node.specular = new Color3(0, 0, 0); // No specular highlights for atmospheric lights
  }

  protected onStart(): void {
    // Nothing to do
  }

  protected onDetach(): void {
    // Nothing to clean up
  }
}
