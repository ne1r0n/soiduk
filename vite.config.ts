import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function git(args: string): string | null {
	try {
		return (
			execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] })
				.toString()
				.trim() || null
		);
	} catch {
		return null;
	}
}

const commit = process.env.GITHUB_SHA?.slice(0, 7) || git('rev-parse --short HEAD') || 'dev';
// The date of the commit, not of the build: the site is rebuilt every night to refresh the timetable, and a
// date that changes nightly would give the script a new name – everyone would download it again every day.
const built = git('log -1 --format=%cs') || new Date().toISOString().slice(0, 10);

export default defineConfig({
	base: './',
	build: { target: 'es2022' },
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__APP_COMMIT__: JSON.stringify(commit),
		__APP_BUILT__: JSON.stringify(built),
	},
});
