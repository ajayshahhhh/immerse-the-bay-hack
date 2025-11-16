import { ActionManager, ExecuteCodeAction, TransformNode } from "@babylonjs/core";

import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export enum InputMode {
	NONE = "none",
	GAMEPLAY = "gameplay",
	DIALOGUE = "dialogue",
	INVENTORY = "inventory"
}

interface ActionRegistration {
	trigger: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	callback: (evt: any) => void;
	behaviorId: string;
}

export class InputModeManager extends BaseSingletonBehavior<TransformNode> {
  public name = "InputModeManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A central input management system that handles switching between different input modes (GAMEPLAY, DIALOGUE, INVENTORY, NONE). Manages ActionManager instances for each mode, handles pointer lock transitions, and provides registration/unregistration of input actions for behaviors. Starts in GAMEPLAY mode by default and automatically manages pointer lock based on mode requirements.",
    whenToAttach: "Must always be used in every game that requires input handling. Essential singleton behavior that other behaviors depend on for input registration.",
    requirementsToAttach: "Must be placed on the `_managers` entity. Should be attached before any behaviors that register input actions (MovementController, DialogueManager, InventoryManager, etc.).",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  public static instance: InputModeManager | null = null;

  private currentMode: InputMode = InputMode.NONE;
  private actionManagers = new Map<InputMode, ActionManager>();
  private actionRegistrations = new Map<InputMode, ActionRegistration[]>();

  // Configuration defining which modes need pointer lock
  private pointerLockConfig = new Map<InputMode, boolean>([
    [InputMode.NONE, false],
    [InputMode.GAMEPLAY, true],
    [InputMode.DIALOGUE, false],
    [InputMode.INVENTORY, false],
  ]);

  // Check if device is mobile
  private get isMobile(): boolean {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  public loadData(): void {}

  protected onAwake(): void {
    // Create ActionManagers for all modes except NONE (NONE has no input processing)
    this.actionManagers.set(InputMode.GAMEPLAY, new ActionManager(this.scene));
    this.actionManagers.set(InputMode.DIALOGUE, new ActionManager(this.scene));
    this.actionManagers.set(InputMode.INVENTORY, new ActionManager(this.scene));

    // Initialize empty registration arrays
    this.actionRegistrations.set(InputMode.GAMEPLAY, []);
    this.actionRegistrations.set(InputMode.DIALOGUE, []);
    this.actionRegistrations.set(InputMode.INVENTORY, []);

    // Set up pointer lock handling
    this.setupPointerLock();

    // Start with gameplay mode active
    this.switchTo(InputMode.GAMEPLAY);
  }

  protected onStart(): void {}

  protected onDetach(): void {
    // Cleanup
    this.actionManagers.forEach(actionManager => {
      actionManager.dispose();
    });
    this.actionManagers.clear();
    this.actionRegistrations.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.scene.actionManager = null as any;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAction(mode: InputMode, trigger: number, callback: (evt: any) => void, behaviorId: string): void {
    const actionManager = this.actionManagers.get(mode);
    const registrations = this.actionRegistrations.get(mode);

    if (!actionManager || !registrations) {
      throw new Error(`Invalid input mode: ${mode}`);
    }

    // Register the action with the ActionManager
    actionManager.registerAction(
      new ExecuteCodeAction(trigger, callback)
    );

    // Track the registration for cleanup
    registrations.push({ trigger, callback, behaviorId });
  }

  unregisterActionsForBehavior(behaviorId: string): void {
    // Remove all actions registered by this behavior from all modes
    for (const [mode, registrations] of this.actionRegistrations) {
      const actionManager = this.actionManagers.get(mode);
      if (actionManager) {
        // Filter out actions from this behavior
        const remainingActions = registrations.filter(reg => reg.behaviorId !== behaviorId);
        this.actionRegistrations.set(mode, remainingActions);

        // Recreate the ActionManager to remove the old actions
        actionManager.dispose();
        const newActionManager = new ActionManager(this.scene);

        // Re-register remaining actions
        remainingActions.forEach(reg => {
          newActionManager.registerAction(
            new ExecuteCodeAction(reg.trigger, reg.callback)
          );
        });

        this.actionManagers.set(mode, newActionManager);

        // If this was the active mode, switch to the new ActionManager
        if (mode === this.currentMode) {
          this.scene.actionManager = newActionManager;
        }
      }
    }
  }

  private setupPointerLock(): void {
    // Skip pointer lock setup on mobile devices
    if (this.isMobile) {
      return;
    }

    const canvas = this.scene.getEngine().getRenderingCanvas();
    if (!canvas) {
      throw new Error("Canvas not available for pointer lock setup");
    }

    // Enable pointer lock on click for any mode that needs it
    canvas.addEventListener("click", () => {
      const needsPointerLock = this.pointerLockConfig.get(this.currentMode) ?? false;
      if (needsPointerLock && canvas.requestPointerLock) {
        canvas.requestPointerLock();
      }
    });
  }

  switchTo(mode: InputMode): void {
    if (this.currentMode === mode) {
      return; // Already in this mode
    }

    const previousMode = this.currentMode;
    const needsPointerLock = this.pointerLockConfig.get(mode) ?? false;
    const previousNeededPointerLock = this.pointerLockConfig.get(previousMode) ?? false;

    // Handle pointer lock transitions (skip on mobile)
    if (!this.isMobile) {
      if (previousNeededPointerLock && !needsPointerLock) {
        // Leaving a mode that needed pointer lock
        if (document.exitPointerLock) {
          document.exitPointerLock();
        }
      } else if (!previousNeededPointerLock && needsPointerLock) {
        // Entering a mode that needs pointer lock
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas && canvas.requestPointerLock) {
          canvas.requestPointerLock();
        }
      }
    }

    // Detach current ActionManager from scene
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.scene.actionManager = null as any;

    // Attach new ActionManager to scene (NONE mode has no ActionManager)
    const newActionManager = this.actionManagers.get(mode);
    if (newActionManager) {
      this.scene.actionManager = newActionManager;
    } else if (mode !== InputMode.NONE) {
      throw new Error(`No ActionManager registered for mode: ${mode}`);
    }

    this.currentMode = mode;
    console.log(`Switched to input mode: ${mode}`);
  }

  getCurrentMode(): InputMode {
    return this.currentMode;
  }
}
