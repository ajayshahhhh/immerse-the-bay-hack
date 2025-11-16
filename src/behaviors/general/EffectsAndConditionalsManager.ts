import { TransformNode } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";
import { DialogueManager } from "../dialogue/DialogueManager";
import { InventoryManager } from "../inventory/InventoryManager";
import { ItemManager } from "../inventory/ItemManager";
import { InteractionManager } from "../interaction/InteractionManager";
import { InputModeManager } from "./InputModeManager";
import { SoundEffectManager } from "./SoundEffectManager";
import { FlagsManager } from "./FlagsManager";

export interface Effect {
	manager: string;
	function: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	args: any[];
}

export interface Conditional {
	manager: string;
	function: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	args: any[];
	comparison: "equal" | "notEqual" | "greaterThan" | "greaterThanOrEqual" | "lessThan" | "lessThanOrEqual";
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	expectedValue: any;
}

export class EffectsAndConditionalsManager extends BaseSingletonBehavior<TransformNode> {
  public name = "EffectsAndConditionalsManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A central execution engine for running effects and evaluating conditionals across game systems. Provides a unified interface to call methods on various manager behaviors (DialogueManager, InventoryManager, FlagsManager, etc.) through structured Effect and Conditional objects. Effects trigger actions like changing flags or adding items, while Conditionals check game state conditions using comparison operators (equal, greater than, etc.). Essential for dialogue systems, quest logic, and any system requiring conditional behavior or cross-system communication.",
    whenToAttach: "Required when using DialogueManager or any system that needs to execute effects or evaluate conditionals. Must be attached whenever you need cross-system communication between different manager behaviors.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Should be attached after all the manager behaviors it references (DialogueManager, InventoryManager, FlagsManager, etc.) are already attached.",
    howToEdit: "Edit the file directly. To add support for new managers, import them and add to the managers object in the constructor."
  } satisfies BehaviorMetadata));

  public static instance: EffectsAndConditionalsManager | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private managers: Record<string, any> = {
    DialogueManager,
    InventoryManager,
    ItemManager,
    InteractionManager,
    InputModeManager,
    SoundEffectManager,
    FlagsManager
  };

  public loadData(): void {}

  protected onAwake(): void {}

  protected onStart(): void {}

  protected onDetach(): void {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private callManagerMethod(manager: string, functionName: string, args: any[]): any {
    const ManagerClass = this.managers[manager];
    if (!ManagerClass) {
      throw new Error(`Manager ${manager} not found`);
    }
    if (!ManagerClass.instance) {
      throw new Error(`Manager ${manager} instance not initialized`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const method = (ManagerClass.instance as any)[functionName];
    if (typeof method !== 'function') {
      throw new Error(`Method ${functionName} not found in ${manager}`);
    }

    return method.apply(ManagerClass.instance, args);
  }

  public executeEffects(effects: Effect[]): void {
    for (const effect of effects) {
      this.callManagerMethod(effect.manager, effect.function, effect.args);
    }
  }

  public evaluateConditional(conditional: Conditional): boolean {
    if (conditional.manager === "none") {
      return true;
    }

    const actualValue = this.callManagerMethod(conditional.manager, conditional.function, conditional.args);

    switch (conditional.comparison) {
    case "equal":
      return actualValue === conditional.expectedValue;
    case "notEqual":
      return actualValue !== conditional.expectedValue;
    case "greaterThan":
      return actualValue > conditional.expectedValue;
    case "greaterThanOrEqual":
      return actualValue >= conditional.expectedValue;
    case "lessThan":
      return actualValue < conditional.expectedValue;
    case "lessThanOrEqual":
      return actualValue <= conditional.expectedValue;
    default:
      return false;
    }
  }

  public evaluateConditionals(conditionals: Conditional[]): boolean {
    for (const conditional of conditionals) {
      if (!this.evaluateConditional(conditional)) {
        return false;
      }
    }
    return true;
  }
}
