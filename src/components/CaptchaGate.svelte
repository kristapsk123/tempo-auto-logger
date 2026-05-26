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

<main class="p-5 min-w-[38.25rem] min-h-[360px] w-full max-w-[1280px] mx-auto font-sans bg-white">
  <header class="mb-4">
    <h1 class="text-base font-semibold text-slate-900 tracking-tight">Verify it's you</h1>
    <p class="text-xs text-slate-400 mt-0.5">
      Solve the challenge below to continue.
    </p>
  </header>

  <section
    class="bg-white border border-slate-200 rounded-xl p-5 flex flex-col items-center gap-3 shadow-sm"
  >
    <canvas
      bind:this={canvasEl}
      class="border border-slate-200 rounded-lg bg-slate-50"
      aria-label="Math challenge image"
    ></canvas>

    <div class="flex items-center gap-2 w-full max-w-xs">
      <label for="captcha-answer" class="text-sm text-slate-600">Answer:</label>
      <input
        id="captcha-answer"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        bind:value={inputValue}
        onkeydown={handleKeydown}
        disabled={isLocked}
        class="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-sm font-mono text-slate-800 disabled:bg-slate-50"
      />
    </div>

    {#if errorMessage}
      <p class="text-xs text-red-600">{errorMessage}</p>
    {/if}
    {#if isLocked}
      <p class="text-xs text-amber-600">
        Too many wrong attempts — please wait a moment.
      </p>
    {/if}

    <div class="flex gap-2">
      <button
        type="button"
        class="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 hover:bg-slate-50 transition-colors"
        onclick={refreshChallenge}
        disabled={isLocked}
      >
        New challenge
      </button>
      <button
        type="button"
        class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700 disabled:opacity-50 transition-colors"
        onclick={verify}
        disabled={isLocked}
      >
        Verify
      </button>
    </div>
  </section>
</main>
