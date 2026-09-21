import type { Capture, ContentRequest, RuntimeReply, RuntimeRequest } from './types.js';

export function sendRuntime(message: RuntimeRequest): Promise<RuntimeReply> {
  return chrome.runtime.sendMessage<RuntimeRequest, RuntimeReply>(message);
}

export function captureTab(tabId: number): Promise<Capture> {
  return chrome.tabs.sendMessage<ContentRequest, Capture>(tabId, { type: 'CAPTURE' });
}
