import {
  Mesh,
  Observer,
  Scene,
  Skeleton,
  Bone,
  TransformNode,
  BoneIKController,
  BoneLookController,
  Space,
} from "@babylonjs/core";

import { BaseBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";
import { z } from "zod";

export class IKController extends BaseBehavior<Mesh> {
  public name = "IKController";
  public static argsSchema = z.object({
    leftPoleTargetEntityId: z.string().describe("Entity ID of the left elbow pole target for IK positioning"),
    rightPoleTargetEntityId: z.string().describe("Entity ID of the right elbow pole target for IK positioning"),
    leftHandTargetEntityId: z.string().optional().describe("Optional entity ID that the left hand should reach towards"),
    rightHandTargetEntityId: z.string().optional().describe("Optional entity ID that the right hand should reach towards")
  }).describe(JSON.stringify({
    summary: "An inverse kinematics controller for character hand positioning using Babylon.js BoneIKController and BoneLookController. Automatically finds skeleton bones by name patterns and sets up IK chains for realistic hand placement on objects. Supports optional hand target entities and pole targets for elbow positioning, with continuous updates during the render loop.",
    whenToAttach: "Use on animated character entities that need realistic hand placement, such as when holding weapons or tools. Typically used with characters that have hand-based interactions.",
    requirementsToAttach: "Must be attached to a `standard/CustomMesh` entity with a skeleton containing bones named with patterns: 'leftforearm', 'rightforearm', 'lefthand', 'righthand'. Requires the specified pole target entities to exist in the scene.",
    howToEdit: "Edit the file directly. Be careful when modifying bone finding logic as it depends on specific naming conventions in the character skeleton."
  } satisfies BehaviorMetadata));

  private beforeRenderObserver: Observer<Scene> | null = null;

  private readonly MAX_ANGLE = Math.PI * 0.9;

  private skeleton?: Skeleton;
  private leftForearmBone?: Bone;
  private rightForearmBone?: Bone;
  private leftHandBone?: Bone;
  private rightHandBone?: Bone;

  private leftHandIKController?: BoneIKController;
  private rightHandIKController?: BoneIKController;

  private leftHandLookController?: BoneLookController;
  private rightHandLookController?: BoneLookController;

  private leftPoleTargetEntityId: string;
  private rightPoleTargetEntityId: string;
  private leftHandTargetEntityId?: string;
  private rightHandTargetEntityId?: string;
  private leftPoleTarget!: TransformNode;
  private rightPoleTarget!: TransformNode;
  private leftHandTarget?: TransformNode;
  private rightHandTarget?: TransformNode;

  constructor(args: unknown) {
    super();
    const validatedArgs = IKController.argsSchema.parse(args);
    this.leftPoleTargetEntityId = validatedArgs.leftPoleTargetEntityId;
    this.rightPoleTargetEntityId = validatedArgs.rightPoleTargetEntityId;
    this.leftHandTargetEntityId = validatedArgs.leftHandTargetEntityId;
    this.rightHandTargetEntityId = validatedArgs.rightHandTargetEntityId;
  }

  protected onAwake(): void {
    this.findSkeleton();
    this.findBones();
    this.findTargetNodes();
    this.setupControllers();
  }

  protected onStart(): void {
    this.beforeRenderObserver = this.scene.onBeforeRenderObservable.add(() => {
      if (!this.leftHandIKController || !this.rightHandIKController || !this.leftHandLookController || !this.rightHandLookController) {
        return;
      }

      if (this.leftHandTarget) {
        this.leftHandIKController.update();
        this.leftHandLookController.target = this.leftPoleTarget.absolutePosition;
        this.leftHandLookController.upAxis = this.leftPoleTarget.forward;
        this.leftHandLookController.upAxisSpace = Space.WORLD;
        this.leftHandLookController.update();
      }
      if (this.rightHandTarget) {
        this.rightHandIKController.update();
        this.rightHandLookController.target = this.rightPoleTarget.absolutePosition;
        this.rightHandLookController.upAxis = this.rightPoleTarget.forward;
        this.rightHandLookController.upAxisSpace = Space.WORLD;
        this.rightHandLookController.update();
      }
    });
  }

  protected onDetach(): void {
    if (this.beforeRenderObserver) {
      this.scene.onBeforeRenderObservable.remove(this.beforeRenderObserver);
      this.beforeRenderObserver = null;
    }
  }

  public setLeftHandTarget(target: TransformNode | null): void {
    this.leftHandTarget = target || undefined;
    if (this.leftHandIKController) {
      // @ts-expect-error This is not supported but must be done
      this.leftHandIKController.targetMesh = target;
    }
  }

  public setRightHandTarget(target: TransformNode | null): void {
    this.rightHandTarget = target || undefined;
    if (this.rightHandIKController) {
      // @ts-expect-error This is not supported but must be done
      this.rightHandIKController.targetMesh = target;
    }
  }

  private findSkeleton(): void {
    // Loop through all skeletons in the scene
    for (const skeleton of this.scene.skeletons) {
      // Check if this skeleton belongs to our node hierarchy
      if (this.isSkeletonInNodeHierarchy(skeleton)) {
        this.skeleton = skeleton;
        return;
      }
    }
    console.warn("No skeleton found for this mesh");
  }

  private isSkeletonInNodeHierarchy(skeleton: Skeleton): boolean {
    // Get the transform node associated with the skeleton
    const skeletonNode = skeleton.bones[0]?.getTransformNode();
    if (!skeletonNode) {
      return false;
    }

    // Recursively walk up the parent chain from the skeleton's node
    let currentNode = skeletonNode;
    while (true) {
      // Check if we've reached our target node (the one with this behavior)
      if (currentNode === this.node) {
        return true;
      }

      // Move up to the parent
      if (!currentNode.parent) {
        break;
      }
      currentNode = currentNode.parent as TransformNode;
    }
    return false;
  }

  private findBones(): void {
    if (!this.skeleton) {
      return;
    }

    const leftForearmBone = this.skeleton.bones.find(bone =>
      bone.name.toLowerCase().includes("leftforearm")
    );
    if (!leftForearmBone) {
      console.warn("Left forearm bone not found");
      return;
    }
    this.leftForearmBone = leftForearmBone;
    console.log(`Found left forearm bone: ${this.leftForearmBone.name}`);

    const rightForearmBone = this.skeleton.bones.find(bone =>
      bone.name.toLowerCase().includes("rightforearm")
    );
    if (!rightForearmBone) {
      console.warn("Right forearm bone not found");
      return;
    }
    this.rightForearmBone = rightForearmBone;
    console.log(`Found right forearm bone: ${this.rightForearmBone.name}`);

    const leftHandBone = this.skeleton.bones.find(bone =>
      bone.name.toLowerCase().includes("lefthand")
    );
    if (!leftHandBone) {
      console.warn("Left hand bone not found");
      return;
    }
    this.leftHandBone = leftHandBone;
    console.log(`Found left hand bone: ${this.leftHandBone.name}`);

    const rightHandBone = this.skeleton.bones.find(bone =>
      bone.name.toLowerCase().includes("righthand")
    );
    if (!rightHandBone) {
      console.warn("Right hand bone not found");
      return;
    }
    this.rightHandBone = rightHandBone;
    console.log(`Found right hand bone: ${this.rightHandBone.name}`);
  }

  private findTargetNodes(): void {
    this.leftPoleTarget = this.scene.getNodeByName(this.leftPoleTargetEntityId) as TransformNode;
    if (!this.leftPoleTarget) {
      throw new Error(`Left pole target node with ID ${this.leftPoleTargetEntityId} not found`);
    }
    console.log(`Found left pole target: ${this.leftPoleTarget.name}`);

    this.rightPoleTarget = this.scene.getNodeByName(this.rightPoleTargetEntityId) as TransformNode;
    if (!this.rightPoleTarget) {
      throw new Error(`Right pole target node with ID ${this.rightPoleTargetEntityId} not found`);
    }
    console.log(`Found right pole target: ${this.rightPoleTarget.name}`);

    if (this.leftHandTargetEntityId) {
      this.leftHandTarget = this.scene.getNodeByName(this.leftHandTargetEntityId) as TransformNode;
      if (!this.leftHandTarget) {
        throw new Error(`Left hand target node with ID ${this.leftHandTargetEntityId} not found`);
      }
      console.log(`Found left hand target: ${this.leftHandTarget.name}`);
    }

    if (this.rightHandTargetEntityId) {
      this.rightHandTarget = this.scene.getNodeByName(this.rightHandTargetEntityId) as TransformNode;
      if (!this.rightHandTarget) {
        throw new Error(`Right hand target node with ID ${this.rightHandTargetEntityId} not found`);
      }
      console.log(`Found right hand target: ${this.rightHandTarget.name}`);
    }
  }

  private setupControllers(): void {
    // Check if we have all required components
    if (!this.skeleton || !this.leftForearmBone || !this.rightForearmBone || !this.leftHandBone || !this.rightHandBone) {
      console.warn("Missing required bones or targets, skipping controllers");
      return;
    }

    this.leftHandIKController = new BoneIKController(
      this.node,
      this.leftForearmBone,
      {
        targetMesh: this.leftHandTarget,
        poleTargetMesh: this.leftPoleTarget,
        poleAngle: Math.PI
      }
    );
    this.leftHandIKController.maxAngle = this.MAX_ANGLE;

    this.rightHandIKController = new BoneIKController(
      this.node,
      this.rightForearmBone,
      {
        targetMesh: this.rightHandTarget,
        poleTargetMesh: this.rightPoleTarget,
        poleAngle: Math.PI
      }
    );
    this.rightHandIKController.maxAngle = this.MAX_ANGLE;

    this.leftHandLookController = new BoneLookController(
      this.node,
      this.leftHandBone,
      this.leftPoleTarget.absolutePosition,
      {
        adjustYaw: 0,
        adjustPitch: 0,
        adjustRoll: 0
      }
    );

    this.rightHandLookController = new BoneLookController(
      this.node,
      this.rightHandBone,
      this.rightPoleTarget.absolutePosition,
      {
        adjustYaw: 0,
        adjustPitch: 0,
        adjustRoll: 0
      }
    );
  }
}
