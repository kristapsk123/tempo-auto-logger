<script lang="ts">
  import {
    generateMathChallenge,
    renderChallengeToCanvas,
    type MathChallenge,
  } from '../lib/captcha-gate';

  let {
    onPass,
  }: {
    onPass: () => void | Promise<void>;
  } = $props();

  const WRONG_ATTEMPTS_BEFORE_BACKOFF = 3;
  const BACKOFF_MS = 2000;

  let challenge = $state<MathChallenge>(generateMathChallenge());
  let inputValue = $state('');
  let wrongAttempts = $state(0);
  let errorMessage = $state<string | null>(null);
  let isLocked = $state(false);
  let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);

  $effect(() => {
    if (canvasEl) {
      renderChallengeToCanvas(canvasEl, challenge);
    }
  });

  function refreshChallenge(): void {
    challenge = generateMathChallenge();
    inputValue = '';
  }

  function lockThenUnlock(): void {
    isLocked = true;
    setTimeout(() => {
      isLocked = false;
    }, BACKOFF_MS);
  }

  function verify(): void {
    if (isLocked) return;
    const parsed = Number.parseInt(inputValue.trim(), 10);
    if (Number.isNaN(parsed)) {
      errorMessage = 'Please enter a number.';
      return;
    }
    if (parsed === challenge.answer) {
      errorMessage = null;
      void onPass();
      return;
    }
    wrongAttempts += 1;
    errorMessage = 'Incorrect — try again.';
    refreshChallenge();
    if (wrongAttempts >= WRONG_ATTEMPTS_BEFORE_BACKOFF) {
      lockThenUnlock();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      verify();
    }
  }
</script>

<main class="p-4 w-[38.25rem] min-h-[360px] font-sans bg-gray-50">
  <header class="mb-3">
    <h1 class="text-lg font-semibold text-gray-900">Verify it's you</h1>
    <p class="text-xs text-gray-500 mt-0.5">
      Solve the challenge below to continue.
    </p>
  </header>

  <section
    class="bg-white border border-gray-200 rounded p-4 flex flex-col items-center gap-3"
  >
    <canvas
      bind:this={canvasEl}
      class="border border-gray-300 rounded bg-slate-100"
      aria-label="Math challenge image"
    ></canvas>

    <div class="flex items-center gap-2 w-full max-w-xs">
      <label for="captcha-answer" class="text-sm text-gray-700">Answer:</label>
      <input
        id="captcha-answer"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        bind:value={inputValue}
        onkeydown={handleKeydown}
        disabled={isLocked}
        class="flex-1 px-2 py-1 border border-gray-300 rounded text-sm font-mono"
      />
    </div>

    {#if errorMessage}
      <p class="text-xs text-red-600">{errorMessage}</p>
    {/if}
    {#if isLocked}
      <p class="text-xs text-amber-700">
        Too many wrong attempts — please wait a moment.
      </p>
    {/if}

    <div class="flex gap-2">
      <button
        type="button"
        class="px-3 py-1 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-100"
        onclick={refreshChallenge}
        disabled={isLocked}
      >
        New challenge
      </button>
      <button
        type="button"
        class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50"
        onclick={verify}
        disabled={isLocked}
      >
        Verify
      </button>
    </div>
  </section>
</main>
