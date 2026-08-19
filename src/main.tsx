import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global optimization: default willReadFrequently to true for all 2D canvases to eliminate readback bottlenecks and browser warnings
if (typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.getContext) {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: any) {
    if (contextId === '2d') {
      options = { willReadFrequently: true, ...(options || {}) };
    }
    return origGetContext.call(this, contextId as any, options);
  } as any;
}
if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas.prototype.getContext) {
  const origGetContext = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (contextId: string, options?: any) {
    if (contextId === '2d') {
      options = { willReadFrequently: true, ...(options || {}) };
    }
    return origGetContext.call(this, contextId as any, options);
  } as any;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

