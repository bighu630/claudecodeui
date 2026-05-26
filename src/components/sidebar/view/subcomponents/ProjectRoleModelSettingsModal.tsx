import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { api } from '../../../../utils/api';
import type { Project, ProjectRoleModelConfig } from '../../../../types/app';
import { Button } from '../../../../shared/view/ui';
import ProjectRoleModelConfigEditor from '../../../project-role-config/ProjectRoleModelConfigEditor';
import { normalizeProjectRoleModelConfig } from '../../../project-role-config/roleModelConfig';

type ProjectRoleModelSettingsModalProps = {
  project: Project;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

export default function ProjectRoleModelSettingsModal({
  project,
  onClose,
  onSaved,
}: ProjectRoleModelSettingsModalProps) {
  const [roleModelConfig, setRoleModelConfig] = useState<ProjectRoleModelConfig>(
    normalizeProjectRoleModelConfig(project.roleModelConfig),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRoleModelConfig(normalizeProjectRoleModelConfig(project.roleModelConfig));
  }, [project]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await api.updateProjectRoleModelConfig(project.projectId, roleModelConfig);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error?.message || payload?.error || 'Failed to save project role settings';
        throw new Error(message);
      }

      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save project role settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Project Role Settings</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{project.displayName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            disabled={isSaving}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <ProjectRoleModelConfigEditor
            value={roleModelConfig}
            onChange={setRoleModelConfig}
            disabled={isSaving}
            title="Role Providers and Models"
            description="Changes here apply to future sessions created for this project."
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
