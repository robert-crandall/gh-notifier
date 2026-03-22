/** @type {import('tailwindcss').Config} */
export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	theme: {
		extend: {
			colors: {
				'surface-container-highest': '#e2e2e4',
				'on-secondary-fixed-variant': '#46464b',
				'on-secondary': '#ffffff',
				surface: '#f9f9fb',
				'on-tertiary': '#ffffff',
				'secondary-container': '#e0dfe4',
				'error-container': '#ffdad6',
				'primary-fixed-dim': '#b3c5ff',
				'tertiary-container': '#c64f00',
				outline: '#717786',
				'tertiary-fixed': '#ffdbcc',
				'on-error': '#ffffff',
				'inverse-primary': '#b3c5ff',
				'inverse-surface': '#2f3132',
				'secondary-fixed': '#e3e2e7',
				'on-primary-container': '#fefcff',
				'surface-variant': '#e2e2e4',
				'outline-variant': '#c1c6d7',
				'secondary-fixed-dim': '#c6c6cb',
				'on-surface-variant': '#414755',
				'surface-container-low': '#f3f3f5',
				'on-primary-fixed': '#001849',
				'on-tertiary-container': '#fffbff',
				'surface-tint': '#0054d6',
				primary: '#0052d1',
				'inverse-on-surface': '#f0f0f2',
				'on-surface': '#1a1c1d',
				'on-primary-fixed-variant': '#003fa4',
				'on-primary': '#ffffff',
				secondary: '#5d5e63',
				'surface-bright': '#f9f9fb',
				'surface-container-lowest': '#ffffff',
				'primary-fixed': '#dae1ff',
				'surface-dim': '#d9dadc',
				'on-tertiary-fixed-variant': '#7c2e00',
				error: '#ba1a1a',
				'on-secondary-container': '#626267',
				'on-tertiary-fixed': '#351000',
				tertiary: '#9e3d00',
				'surface-container': '#eeeef0',
				'on-error-container': '#93000a',
				'primary-container': '#156aff',
				'on-secondary-fixed': '#1a1b1f',
				background: '#f9f9fb',
				'surface-container-high': '#e8e8ea',
				'on-background': '#1a1c1d',
				'tertiary-fixed-dim': '#ffb595'
			},
			fontFamily: {
				headline: ['Inter', 'system-ui', 'sans-serif'],
				body: ['Inter', 'system-ui', 'sans-serif'],
				label: ['Inter', 'system-ui', 'sans-serif']
			},
			borderRadius: {
				DEFAULT: '0.125rem',
				lg: '0.25rem',
				xl: '0.5rem',
				full: '0.75rem'
			}
		}
	},
	plugins: []
};
