import { TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export class FlagsManager extends BaseSingletonBehavior<TransformNode> {
  public name = "FlagsManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A simple singleton manager for storing and retrieving global game flags as key-value pairs. Provides basic flag operations: setting, getting, checking existence, and removing flags. Supports any data type as flag values (boolean, string, number, objects). Useful for tracking game state, quest completion, settings, and any persistent data that needs to be accessible across different behaviors and systems.",
    whenToAttach: "Use ONLY for true global game state - single values shared across the entire game. Examples: quest progress, game settings, unlocked features. DO NOT use for per-entity properties like health, position, or status effects - even if other behaviors access them, each entity should have its own instance of these values.",
    requirementsToAttach: "Must be placed on the `_managers` entity. No dependencies on other behaviors.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  public static instance: FlagsManager | null = null;

  private flags: Record<string, unknown> = {};

  public loadData(): void {}

  protected onAwake(): void {}

  protected onStart(): void {}

  protected onDetach(): void {
    this.flags = {};
  }

  public setFlag(key: string, value: unknown): void {
    this.flags[key] = value;
  }

  public getFlag<T = unknown>(key: string): T | undefined {
    return this.flags[key] as T;
  }

  public hasFlag(key: string): boolean {
    return key in this.flags;
  }

  public removeFlag(key: string): void {
    delete this.flags[key];
  }
}
