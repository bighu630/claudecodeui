import type { ChangeEvent } from 'react';

import type { LLMProvider, ProjectRoleModelConfig, ProjectRoleType } from '../../types/app';
import { PROJECT_ROLE_LABELS, PROJECT_ROLE_TYPES } from './roleModelConfig';

type ProjectRoleModelConfigEditorProps = {
  value: ProjectRoleModelConfig;
  onChange: (nextValue: ProjectRoleModelConfig) => void;
  title?: string;
  description?: string;
  disabled?: boolean;
};

const PROVIDER_OPTIONS: Array<{ value: LLMProvider; label: string }> = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'gemini', label: 'Gemini' },
];

function updateRoleField(
  value: ProjectRoleModelConfig,
  role: ProjectRoleType,
  field: 'provider' | 'model',
  nextFieldValue: string,
): ProjectRoleModelConfig {
  return {
    ...value,
    [role]: {
      ...value[role],
      [field]: nextFieldValue,
    },
  };
}

export default function ProjectRoleModelConfigEditor({
  value,
  onChange,
  title = 'Role Model Settings',
  description = 'Choose the provider and default model for each role in this project.',
  disabled = false,
}: ProjectRoleModelConfigEditorProps) {
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h4>
        <p className="text-xs text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      <div className="space-y-3">
        {PROJECT_ROLE_TYPES.map((role) => (
          <div
            key={role}
            className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800 md:grid-cols-[140px_minmax(0,1fr)_minmax(0,1fr)] md:items-center"
          >
            <div className="text-sm font-medium text-gray-900 dark:text-white">{PROJECT_ROLE_LABELS[role]}</div>

            <label className="space-y-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400">Provider</span>
              <select
                value={value[role].provider}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  onChange(updateRoleField(value, role, 'provider', event.target.value));
                }}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
              >
                {PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-xs text-gray-500 dark:text-gray-400">Model</span>
              <input
                type="text"
                value={value[role].model}
                disabled={disabled}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  onChange(updateRoleField(value, role, 'model', event.target.value));
                }}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
                placeholder="Model name"
              />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
