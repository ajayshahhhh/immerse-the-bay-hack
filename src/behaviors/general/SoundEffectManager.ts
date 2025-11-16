import { TransformNode, Vector3, AudioEngineV2, StaticSound, CreateAudioEngineAsync, CreateSoundAsync, SoundState } from "@babylonjs/core";
import { z } from "zod";

import { BaseSingletonBehavior, type BehaviorMetadata } from "@moonlakeai/game-sdk";

export class SoundEffectManager extends BaseSingletonBehavior<TransformNode> {
  public name = "SoundEffectManager";
  public static argsSchema = z.object({}).describe(JSON.stringify({
    summary: "Simple sound effect manager for playing audio from URLs.",
    whenToAttach: "Attach to the `_managers` entity.",
    requirementsToAttach: "Must be placed on the `_managers` entity.",
    howToEdit: "Edit the file directly."
  } satisfies BehaviorMetadata));

  public static instance: SoundEffectManager | null = null;

  private audioEngine: AudioEngineV2 | null = null;
  private soundCache = new Map<string, StaticSound>();

  public loadData(): void {}

  protected async onAwake(): Promise<void> {
    this.audioEngine = await CreateAudioEngineAsync();
  }

  protected onStart(): void {}

  protected onDetach(): void {
    this.soundCache.forEach(sound => sound.dispose());
    this.soundCache.clear();
  }

  public async playSound(
    url: string,
    volume: number,
    loop: boolean,
    spatialEnabled: boolean,
    position: Vector3 | null = null,
    dontRepeatIfPlaying: boolean
  ) {
    if (!this.audioEngine) {
      throw new Error("audioEngine not defined");
    }

    this.audioEngine.unlockAsync();

    let sound = this.soundCache.get(url);

    if (!sound) {
      sound = await CreateSoundAsync(
        `sound_${url.split('/').pop()}`,
        url,
        { volume: volume, loop: loop, spatialEnabled: spatialEnabled }
      );
      this.soundCache.set(url, sound);
    } else {
      sound.loop = loop;
      sound.volume = volume;
    }

    if (spatialEnabled && position) {
      sound.spatial.position = position;
    }

    if (!dontRepeatIfPlaying || sound.state != SoundState.Started) {
      sound.play();
    }
  }

  public stopSound(url: string): void {
    const sound = this.soundCache.get(url);
    sound?.stop();
  }

  public stopAllSounds(): void {
    this.soundCache.forEach(sound => sound.stop());
  }
}
