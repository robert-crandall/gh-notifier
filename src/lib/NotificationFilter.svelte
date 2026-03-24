<script lang="ts">
	import type { GithubNotification } from '$lib/types';
	import {
		applyFilters,
		formatChipValue,
		ALL_DIMS,
		FREE_TEXT_DIMS,
		SELECT_OPTIONS,
		type FilterChip,
		type FilterDimension,
	} from '$lib/notification-filter';

	let {
		notifications,
		filteredCount,
		chips = $bindable<FilterChip[]>([]),
	}: {
		notifications: GithubNotification[];
		filteredCount: number;
		chips: FilterChip[];
	} = $props();

	let dropdownOpen = $state(false);
	let pendingDimension = $state<FilterDimension | null>(null);
	let pendingValue = $state('');
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let triggerEl = $state<HTMLButtonElement | null>(null);

	function selectDimension(dim: FilterDimension) {
		pendingDimension = dim;
		pendingValue = '';
	}

	function addChip() {
		if (!pendingDimension || !pendingValue.trim()) return;
		chips = [
			...chips,
			{ id: crypto.randomUUID(), dimension: pendingDimension, value: pendingValue.trim() },
		];
		pendingDimension = null;
		pendingValue = '';
		dropdownOpen = false;
		triggerEl?.focus();
	}

	function addSelectChip(dim: FilterDimension, value: string) {
		chips = [...chips, { id: crypto.randomUUID(), dimension: dim, value }];
		pendingDimension = null;
		pendingValue = '';
		dropdownOpen = false;
		triggerEl?.focus();
	}

	function removeChip(id: string) {
		chips = chips.filter((c) => c.id !== id);
	}

	function clearAll() {
		chips = [];
	}

	function closeDropdown() {
		dropdownOpen = false;
		pendingDimension = null;
		pendingValue = '';
		triggerEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && dropdownOpen) {
			closeDropdown();
		}
	}

	function handleMousedown(event: MouseEvent) {
		if (wrapperEl && !wrapperEl.contains(event.target as Node)) {
			closeDropdown();
		}
	}

	$effect(() => {
		if (dropdownOpen) {
			document.addEventListener('mousedown', handleMousedown);
			return () => document.removeEventListener('mousedown', handleMousedown);
		}
	});

	$effect(() => {
		if (pendingDimension && FREE_TEXT_DIMS.includes(pendingDimension) && inputEl) {
			inputEl.focus();
		}
	});

	function isFreeText(dim: FilterDimension): boolean {
		return FREE_TEXT_DIMS.includes(dim);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-wrap items-center gap-2" bind:this={wrapperEl}>
	<!-- Trigger -->
	<div class="relative">
		<button
			bind:this={triggerEl}
			onclick={() => {
				dropdownOpen = !dropdownOpen;
				if (!dropdownOpen) {
					pendingDimension = null;
					pendingValue = '';
				}
			}}
			aria-expanded={dropdownOpen}
			aria-controls="filter-dropdown"
			aria-haspopup="true"
			class="px-4 py-2 text-xs font-semibold text-on-surface bg-surface-container-highest rounded-md hover:bg-surface-dim transition-all duration-200 flex items-center gap-2"
		>
			<span class="material-symbols-outlined text-[16px]">filter_list</span>
			Filter
			{#if chips.length > 0}
				<span
					class="w-4 h-4 flex items-center justify-center bg-primary text-on-primary rounded-full text-[10px] font-bold leading-none"
				>
					{chips.length}
				</span>
			{/if}
		</button>

		{#if dropdownOpen}
			<div
				id="filter-dropdown"
				role="dialog"
				aria-label="Filter options"
				class="absolute left-0 top-full mt-2 bg-surface-container-lowest border border-outline-variant/20 shadow-2xl rounded-xl w-56 z-50 overflow-hidden"
			>
				{#if pendingDimension === null}
					<!-- Dimension picker -->
					<div class="p-2">
						<p class="text-[10px] font-black text-on-surface-variant tracking-widest px-3 py-2">
							FILTER BY
						</p>
						{#each ALL_DIMS as dim (dim)}
							<button
								class="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-low rounded-lg transition-colors capitalize"
								onclick={() => selectDimension(dim)}
							>
								{dim.replace(/_/g, ' ')}
							</button>
						{/each}
					</div>
				{:else if isFreeText(pendingDimension)}
					<!-- Free-text input -->
					<div class="p-4">
						<p
							class="text-[10px] font-black text-on-surface-variant tracking-widest mb-3 capitalize"
						>
							{pendingDimension}
						</p>
						<input
							bind:this={inputEl}
							class="w-full bg-surface-container-low border border-outline-variant/20 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-none focus:border-primary/50"
							placeholder="Type to filter…"
							bind:value={pendingValue}
							onkeydown={(e) => {
								if (e.key === 'Enter') addChip();
								if (e.key === 'Escape') closeDropdown();
							}}
						/>
						<div class="flex gap-2 mt-3">
							<button
								class="flex-1 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-40"
								disabled={!pendingValue.trim()}
								onclick={addChip}
							>
								Apply
							</button>
							<button
								class="px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface rounded-lg"
								onclick={() => {
									pendingDimension = null;
									pendingValue = '';
								}}
							>
								Back
							</button>
						</div>
					</div>
				{:else}
					<!-- Select list -->
					<div class="p-2">
						<p
							class="text-[10px] font-black text-on-surface-variant tracking-widest px-3 py-2 capitalize"
						>
							{pendingDimension}
						</p>
						{#each SELECT_OPTIONS[pendingDimension] ?? [] as option (option)}
							<button
								class="w-full text-left px-3 py-2 text-sm hover:bg-surface-container-low rounded-lg transition-colors capitalize"
								onclick={() => addSelectChip(pendingDimension!, option)}
							>
								{formatChipValue(pendingDimension!, option)}
							</button>
						{/each}
						<button
							class="w-full text-left px-3 py-2 text-xs text-on-surface-variant hover:text-on-surface rounded-lg mt-1 border-t border-outline-variant/10"
							onclick={() => {
								pendingDimension = null;
								pendingValue = '';
							}}
						>
							← Back
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Active chips -->
	{#each chips as chip (chip.id)}
		<span
			class="flex items-center gap-1 bg-primary/10 border border-primary/20 text-primary text-xs font-medium px-2.5 py-1 rounded-full"
		>
			<span class="opacity-70 capitalize">{chip.dimension}:</span>
			<span>{formatChipValue(chip.dimension, chip.value)}</span>
			<button
				onclick={() => removeChip(chip.id)}
				class="ml-0.5 hover:text-error transition-colors flex items-center"
				aria-label="Remove filter {chip.dimension}: {chip.value}"
			>
				<span class="material-symbols-outlined text-[14px]">close</span>
			</button>
		</span>
	{/each}

	<!-- Clear all + count -->
	{#if chips.length > 0}
		<button
			onclick={clearAll}
			class="text-xs text-on-surface-variant hover:text-on-surface transition-colors hover:underline underline-offset-2"
		>
			Clear all
		</button>
		<span class="text-xs text-on-surface-variant">
			Showing {filteredCount} of {notifications.length}
		</span>
	{/if}
</div>
