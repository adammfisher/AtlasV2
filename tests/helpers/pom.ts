/**
 * Page Object Models (TESTPLAN §4). All selectors via data-testid.
 */
import type { FrameLocator, Locator, Page } from '@playwright/test';

export class ChatPage {
  constructor(readonly page: Page) {}

  get composer(): Locator {
    return this.page.getByTestId('composer');
  }
  get sendBtn(): Locator {
    return this.page.getByTestId('send-btn');
  }
  get thread(): Locator {
    return this.page.getByTestId('chat-thread');
  }
  get emptyState(): Locator {
    return this.page.getByTestId('chat-empty-state');
  }
  get liveExchange(): Locator {
    return this.page.getByTestId('live-exchange');
  }
  get streamError(): Locator {
    return this.page.getByTestId('stream-error');
  }
  get streamRetry(): Locator {
    return this.page.getByTestId('stream-retry');
  }
  get artifactCards(): Locator {
    return this.page.getByTestId('artifact-card');
  }
  get newChatBtn(): Locator {
    return this.page.getByTestId('new-chat');
  }

  /** true while a stream is in flight (send button shows Stop). */
  get busy(): Locator {
    return this.page.locator('[data-testid="send-btn"][data-busy="true"]');
  }
  get idle(): Locator {
    return this.page.locator('[data-testid="send-btn"][data-busy="false"]');
  }

  async send(text: string): Promise<void> {
    await this.composer.fill(text);
    await this.composer.press('Enter');
  }

  /** Event-driven wait for stream completion — no polling sleeps. */
  async waitStreamDone(timeout = 240_000): Promise<void> {
    await this.busy.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
    await this.idle.waitFor({ state: 'visible', timeout });
  }
}

export class ArtifactPanelPom {
  constructor(readonly page: Page) {}

  get root(): Locator {
    return this.page.getByTestId('artifact-panel');
  }
  /** the sandboxed preview iframe (react/site/svg/mermaid/md). */
  get frame(): FrameLocator {
    return this.page.frameLocator('iframe[title="artifact preview"]');
  }
  /** the office/pdf document-view iframe. */
  get docFrame(): FrameLocator {
    return this.page.frameLocator('iframe[title="document preview"]');
  }
  version(n: number): Locator {
    return this.root.getByRole('button', { name: `v${n}`, exact: true });
  }
  get downloadBtn(): Locator {
    return this.root.getByRole('button', { name: /Download as/ });
  }
}

export class LivePanelPom {
  constructor(readonly page: Page) {}
  get root(): Locator {
    return this.page.getByTestId('live-panel');
  }
}
