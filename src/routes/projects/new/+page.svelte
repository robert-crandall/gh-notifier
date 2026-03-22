<script lang="ts">
	import { goto } from '$app/navigation';
	import * as api from '$lib/api';

	let name = $state('');
	let saving = $state(false);
	let error = $state('');

	async function create() {
		if (!name.trim()) {
			error = 'Project name is required.';
			return;
		}
		saving = true;
		error = '';
		try {
			const project = await api.createProject(name.trim());
			goto(`/projects/${project.id}`);
		} catch (e) {
			error = `Failed to create project: ${e}`;
			saving = false;
		}
	}
</script>

<div class="flex items-center justify-center h-full p-12">
	<div class="max-w-md w-full space-y-6">
		<div>
			<h1 class="text-2xl font-bold tracking-tight text-on-surface mb-1">New Project</h1>
			<p class="text-sm text-on-surface-variant">Give your project a name to get started.</p>
		</div>

		<div class="space-y-4">
			<div>
				<label for="project-name" class="text-[11px] font-bold uppercase tracking-widest text-on-surface-variant mb-2 block">
					Project Name
				</label>
				<input
					id="project-name"
					type="text"
					bind:value={name}
					placeholder="e.g. api-gateway-mesh"
					class="w-full bg-surface-container-high border border-outline-variant/20 rounded-xl py-3 px-4 text-sm focus:ring-2 focus:ring-primary/40 focus:border-transparent placeholder:text-on-surface-variant/40"
					onkeydown={(e) => e.key === 'Enter' && create()}
				/>
			</div>

			{#if error}
				<p class="text-error text-xs">{error}</p>
			{/if}

			<div class="flex gap-3">
				<button
					class="flex-1 px-4 py-3 bg-primary text-on-primary rounded-xl font-semibold text-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
					onclick={create}
					disabled={saving}
				>
					{saving ? 'Creating...' : 'Create Project'}
				</button>
				<button
					class="px-4 py-3 bg-surface-container-high text-on-surface-variant rounded-xl text-sm hover:bg-surface-container-highest transition-colors"
					onclick={() => goto('/')}
				>
					Cancel
				</button>
			</div>
		</div>
	</div>
</div>
