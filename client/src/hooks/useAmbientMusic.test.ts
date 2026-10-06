import test from "node:test";
import assert from "node:assert/strict";
import {
  AMBIENT_DUCKED_VOLUME,
  AMBIENT_TRACKS,
  AMBIENT_VOLUME,
  getAmbientVolume,
  getNextAmbientTrackIndex,
} from "./useAmbientMusic";

test("mantém a ordem definida para a playlist ambiente", () => {
  assert.deepEqual(AMBIENT_TRACKS, [
    "/music/no-rush-vintage-noir-jazz.mpeg",
  ]);
});

test("repete a faixa ambiente ao terminar", () => {
  const playedIndexes: number[] = [];
  let currentIndex = 0;

  for (let count = 0; count < AMBIENT_TRACKS.length + 1; count += 1) {
    playedIndexes.push(currentIndex);
    currentIndex = getNextAmbientTrackIndex(currentIndex);
  }

  assert.deepEqual(playedIndexes, [0, 0]);
});

test("mantém a música em 16% e reduz para 2% durante a narração", () => {
  assert.equal(AMBIENT_VOLUME, 0.16);
  assert.equal(AMBIENT_DUCKED_VOLUME, 0.02);
  assert.equal(getAmbientVolume(null), 0.16);
  assert.equal(getAmbientVolume("cue"), 0.02);
  assert.equal(getAmbientVolume("speaking"), 0.02);
  assert.equal(getAmbientVolume("displaying"), 0.16);
});
