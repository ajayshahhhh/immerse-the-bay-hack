import { TransformNode, Node } from "@babylonjs/core";
import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export class PrefabManager extends BaseSingletonBehavior<TransformNode> {
  public name = "PrefabManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "A singleton manager for instantiating prefabs at runtime. Provides a simple interface to spawn prefab instances with custom positioning, rotation, scaling, and parent relationships. Acts as a bridge to the underlying scene loader system for dynamic entity creation during gameplay.",
    whenToAttach: "Must be used when dynamic prefab instantiation is needed, such as spawning items, enemies, or interactive objects during gameplay. Required by HoldableSwitcher and other systems that create objects at runtime.",
    requirementsToAttach: "Must be placed on the `_managers` entity. The sceneLoader must be provided through loadData() method during initialization.",
    howToEdit: "Edit the file directly. The actual prefab loading logic is handled by the underlying sceneLoader system."
  } satisfies BehaviorMetadata));

  public static instance: PrefabManager | null = null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sceneLoader!: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public loadData(args: Record<string, any>): void {
    this.sceneLoader = args.sceneLoader;
  }

  protected onAwake(): void {
    PrefabManager.instance = this;
  }

  protected onStart(): void {}

  protected onDetach(): void {}

  public async instantiatePrefab(
    prefabId: string,
    instanceId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    variables: Record<string, any>,
    position?: [number, number, number],
    rotation?: [number, number, number],
    scaling?: [number, number, number],
    parentEntity?: Node
  ): Promise<Node> {
    return await this.sceneLoader.instantiatePrefabAtRuntime(prefabId, instanceId, variables, position, rotation, scaling, parentEntity);
  }
}
