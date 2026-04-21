<script lang="ts">
  type Tab = 'general' | 'meetings' | 'github' | 'templates' | 'about';
  let active = $state<Tab>('general');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'github', label: 'GitHub' },
    { id: 'templates', label: 'Templates' },
    { id: 'about', label: 'About' },
  ];
</script>

<main class="min-h-screen bg-gray-50 font-sans">
  <div class="max-w-4xl mx-auto p-6">
    <header class="mb-6">
      <h1 class="text-2xl font-semibold text-gray-900">Tempo Auto Logger</h1>
      <p class="text-sm text-gray-600 mt-1">Settings</p>
    </header>

    <div class="bg-white rounded shadow-sm border border-gray-200">
      <nav class="flex border-b border-gray-200" aria-label="Settings tabs">
        {#each tabs as tab (tab.id)}
          <button
            class="px-4 py-3 text-sm font-medium border-b-2 -mb-px {active === tab.id
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900'}"
            onclick={() => (active = tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </nav>

      <div class="p-6">
        {#if active === 'general'}
          <h2 class="text-lg font-medium text-gray-900">General</h2>
          <p class="text-sm text-gray-600 mt-2">
            Attendance filter and date-range defaults will go here.
          </p>
        {:else if active === 'meetings'}
          <h2 class="text-lg font-medium text-gray-900">Meetings</h2>
          <p class="text-sm text-gray-600 mt-2">
            Learned calendar → Jira mappings. Team defaults are shown in italics.
          </p>
        {:else if active === 'github'}
          <h2 class="text-lg font-medium text-gray-900">GitHub</h2>
          <p class="text-sm text-gray-600 mt-2">
            Personal access token and scanned orgs.
          </p>
        {:else if active === 'templates'}
          <h2 class="text-lg font-medium text-gray-900">Templates</h2>
          <p class="text-sm text-gray-600 mt-2">
            Description templates for commits, reviews, and meetings.
          </p>
        {:else if active === 'about'}
          <h2 class="text-lg font-medium text-gray-900">About</h2>
          <p class="text-sm text-gray-600 mt-2">
            Version, links, and troubleshooting.
          </p>
        {/if}
      </div>
    </div>
  </div>
</main>
