import type { Resolution } from './settings.ts';

// Buffer resolution controls projection; CSS presentation controls stretching / black bars independently.
export function displayLayout(resolution: Resolution, scaling: 'stretch' | 'fit', width: number, height: number, dpr = 1) {
  const [bufferWidth, bufferHeight] = resolution === 'native'
    ? [Math.round(width * Math.min(2, dpr)), Math.round(height * Math.min(2, dpr))] : resolution.split('x').map(Number);
  const scale = scaling === 'fit' ? Math.min(width / bufferWidth, height / bufferHeight) : 0;
  const cssWidth = scale ? bufferWidth * scale : width, cssHeight = scale ? bufferHeight * scale : height;
  return { bufferWidth, bufferHeight, aspect: bufferWidth / bufferHeight, cssWidth, cssHeight,
    left: (width - cssWidth) / 2, top: (height - cssHeight) / 2 };
}
