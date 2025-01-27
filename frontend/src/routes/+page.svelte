<script>
	import { marked } from 'marked';

	import { ClipboardCopyIcon, Download, Loader, SparkleIcon, Trash } from 'lucide-svelte';

	// Reactive state
	let url = 'https://www.yaqeen.me';
	let maxDepth = 1;
	let loading = false;
	let error = '';
	let result = '';
	let activeTab = 'content';

	// Derived state
	$: sections = result ? result.split('---pageEnd').slice(1) : [];
	$: structure = result ? result.split('---')[0] : '';
	$: showResults = result && !error;

	// Methods
	const handleConversion = async () => {
		loading = true;
		error = '';
		result = '';

		try {
			const response = await fetch(
				`http://localhost:8000/gx?url=${encodeURIComponent(url)}&depth=${maxDepth}`
			);

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.detail || 'Conversion failed');
			}

			result = await response.text();
		} catch (err) {
			error = err.message;
		} finally {
			loading = false;
		}
	};

	function downloadFile() {
		const textContent = result;

		const blob = new Blob([textContent], { type: 'text/plain' });

		const url = window.URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.style.display = 'none';
		a.href = url;
		a.download = `${url.replace('http://', '').replace('https://', '')}.md`;

		document.body.appendChild(a);
		a.click();

		window.URL.revokeObjectURL(url);
		document.body.removeChild(a);
	}

	const copyResults = () => navigator.clipboard.writeText(result);

	export function formatNumber(num) {
		if (num >= 1000000) {
			return (num / 1000000).toFixed(1) + 'M';
		}
		if (num >= 1000) {
			return (num / 1000).toFixed(1) + 'K';
		}
		return num.toString();
	}
</script>

<main class="min-h-screen bg-[#eeffb3] bg-gradient-to-br p-8">
	<div class="mx-auto max-w-4xl space-y-8">
		<!-- Header -->
		<header class="class flex flex-col items-center space-y-4 text-center">
			<img src="/hero.svg" height="100" width="300" />
			<h1
				class="rounded-lg bg-gradient-to-r from-[#c6ff00] to-lime-400 p-2 text-4xl font-bold text-lime-700"
			>
			    LMFetch
			</h1>
			<p class="text-lg text-gray-800">Transform websites into structured LLM-ready text</p>
		</header>

		<!-- Conversion Form -->
		<form on:submit|preventDefault={handleConversion} class="space-y-6">
			<div class="flex items-end gap-4">
				<div class="flex-1 space-y-2">
					<label class="block text-sm font-medium text-gray-700">Website URL</label>
					<input
						type="url"
						bind:value={url}
						class="w-full rounded-lg border border-gray-600 bg-lime-100 px-4 py-3 text-gray-900 focus:ring-2 focus:ring-blue-400"
						placeholder="https://example.com"
					/>
				</div>

				<button
					type="submit"
					class="flex items-center gap-2 rounded-lg bg-[#c6ff00] px-6 py-3 font-medium text-black transition-colors"
					disabled={loading}
				>
					{#if loading}
						<span class="animate-spin"><Loader /></span>
						Processing...
					{:else}
						<SparkleIcon />
						Convert
					{/if}
				</button>
			</div>

			<div class="flex items-center gap-4">
				<select
					bind:value={maxDepth}
					class="rounded-lg border border-gray-600 bg-[#c6ff00] px-4 py-2 text-gray-800"
				>
					<option value={1}>Depth 1 - Surface</option>
					<option value={2}>Depth 2 - Moderate</option>
					<option value={3}>Depth 3 - Deep</option>
				</select>

				<span class="text-sm text-gray-700"> Higher depth = more comprehensive conversion </span>
			</div>
		</form>

		<!-- Error State -->
		{#if error}
			<div class="rounded-lg border border-red-800 bg-red-900/30 p-4 text-red-300">
				{error}
			</div>
		{/if}

		<!-- Results -->
		{#if showResults}
			<article
				class="relative max-h-[500px] space-y-6 overflow-y-auto rounded-xl bg-[#c6ff00] px-6 pb-6 text-gray-900 shadow-xl"
			>
				<div class="sticky top-0 bg-[#c6ff00] pt-6">
					<div class="flex items-center justify-between">
						<h2 class="text-xl font-semibold">Crawl Results</h2>

						<div class="flex gap-3">
							<div>
								{formatNumber(result.length)} words
							</div>
							<button
								on:click={downloadFile}
								class="flex items-center gap-2 text-gray-800 transition-colors hover:text-blue-400"
							>
								<Download />
							</button>
							<button
								on:click={copyResults}
								class="flex items-center gap-2 text-gray-800 transition-colors hover:text-blue-400"
							>
								<ClipboardCopyIcon />
								Copy
							</button>
							<!-- <button
                            on:click={() => result = ''}
                            class="flex items-center gap-2 text-gray-800 hover:text-red-400 transition-colors"
                        >
                            <Trash />
                            Clear
                        </button> -->
						</div>
					</div>

					<!-- Tabs -->
					<div class="border-b border-gray-700">
						<div class="flex gap-6">
							<button
								class="pb-2"
								class:border-b-2={activeTab === 'content'}
								class:border-lime-400={activeTab === 'content'}
								class:text-gray-900={activeTab === 'content'}
								class:text-gray-700={activeTab !== 'content'}
								on:click={() => (activeTab = 'content')}
							>
								Content
							</button>
							<button
								class="pb-2"
								class:border-b-2={activeTab === 'structure'}
								class:border-lime-400={activeTab === 'structure'}
								class:text-gray-900={activeTab === 'structure'}
								class:text-gray-700={activeTab !== 'structure'}
								on:click={() => (activeTab = 'structure')}
							>
								Site Structure
							</button>
						</div>
					</div>
				</div>

				<!-- Content -->
				{#if activeTab === 'content'}
					<div class="space-y-4">
						{#each sections as section}
							{#if section.trim()}
								<section class=" max-w-none rounded-lg bg-lime-100 p-4 text-gray-800">
									{section}
								</section>
							{/if}
						{/each}
					</div>
				{:else}
					<pre class="rounded-lg bg-lime-100 p-4 font-mono text-sm text-gray-800">
                        {structure}
                    </pre>
				{/if}
			</article>
		{/if}
	</div>
</main>

<style>
	.prose-invert {
		color: #cbd5e1;
	}
	.prose-invert h3 {
		color: #e2e8f0;
		font-size: 1.25rem;
		margin: 1.5rem 0 1rem;
	}
	.prose-invert a {
		color: #93c5fd;
		text-decoration: underline;
	}
</style>
