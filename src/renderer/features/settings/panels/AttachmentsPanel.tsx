/**
 * Attachment settings — files attached in the composer (picker / drag-drop /
 * paste) become session-owned staged copies under the app's user-data dir. The
 * agent reads them on demand through its tool loop; images can additionally be
 * sent to the model as vision blocks. Attaching never executes anything and
 * archives are never extracted.
 */
import { ATTACHMENT_LIMITS, clamp } from '@shared/constants';
import { useSettingsStore } from '@/renderer/stores/useSettingsStore';
import { Field, Section, SegmentedControl, Select, Toggle } from '../controls';

export function AttachmentsPanel() {
  const attachments = useSettingsStore((s) => s.settings.attachments);
  const update = useSettingsStore((s) => s.update);
  const A = ATTACHMENT_LIMITS;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Attachments"
        hint="Files attached in the composer are validated, hashed, and staged per session on-device. The agent reads them on demand — their contents are never bulk-inserted into the prompt."
      >
        <Field
          id="attEnabled"
          label="Enable attachments"
          hint="Master switch for the composer attach button, drag & drop, and image paste."
        >
          <Toggle
            checked={attachments.enabled}
            onChange={(v) => void update({ attachments: { enabled: v } })}
          />
        </Field>
        <Field
          id="attMaxFileSize"
          label="Max file size"
          hint="Files above this size are refused at attach time."
        >
          <Select<number>
            value={clamp(attachments.maxFileSizeMB, A.maxFileSizeMB.min, A.maxFileSizeMB.max)}
            options={[5, 10, 25, 50, 100].map((n) => ({ value: n, label: `${n} MB` }))}
            onChange={(v) => void update({ attachments: { maxFileSizeMB: v } })}
          />
        </Field>
        <Field
          id="attMaxPerMessage"
          label="Files per message"
          hint="How many files can ride a single prompt."
        >
          <Select<number>
            value={clamp(attachments.maxFilesPerMessage, A.maxFilesPerMessage.min, A.maxFilesPerMessage.max)}
            options={[3, 5, 10, 15, 20].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => void update({ attachments: { maxFilesPerMessage: v } })}
          />
        </Field>
        <Field
          id="attMaxPerSession"
          label="Files per session"
          hint="Total attachments a session may accumulate across its lifetime."
        >
          <Select<number>
            value={clamp(attachments.maxTotalPerSession, A.maxTotalPerSession.min, A.maxTotalPerSession.max)}
            options={[25, 50, 100, 250, 500].map((n) => ({ value: n, label: String(n) }))}
            onChange={(v) => void update({ attachments: { maxTotalPerSession: v } })}
          />
        </Field>
      </Section>

      <Section
        title="File types"
        hint="Which categories may be attached. Archives are never extracted automatically; executables and scripts are elevated risk regardless of category."
      >
        <Field id="attCatImages" label="Images" hint="Screenshots, mockups, diagrams (png, jpg, gif, webp, svg…).">
          <Toggle
            checked={attachments.categories.images}
            onChange={(v) => void update({ attachments: { categories: { images: v } } })}
          />
        </Field>
        <Field id="attCatDocuments" label="Documents & data" hint="Specs, logs, PDFs, JSON/YAML/CSV configs.">
          <Toggle
            checked={attachments.categories.documents}
            onChange={(v) => void update({ attachments: { categories: { documents: v } } })}
          />
        </Field>
        <Field id="attCatCode" label="Source code" hint="Code files in any language.">
          <Toggle
            checked={attachments.categories.code}
            onChange={(v) => void update({ attachments: { categories: { code: v } } })}
          />
        </Field>
        <Field id="attCatArchives" label="Archives" hint="zip/tar/7z… — staged as-is, never extracted.">
          <Toggle
            checked={attachments.categories.archives}
            onChange={(v) => void update({ attachments: { categories: { archives: v } } })}
          />
        </Field>
        <Field
          id="attRiskPolicy"
          label="Executables & scripts"
          hint="Block refuses them outright; Warn stages them flagged. Attaching never executes anything."
        >
          <SegmentedControl<typeof attachments.elevatedRiskPolicy>
            value={attachments.elevatedRiskPolicy}
            options={[
              { value: 'block', label: 'Block' },
              { value: 'warn', label: 'Warn' },
            ]}
            onChange={(v) => void update({ attachments: { elevatedRiskPolicy: v } })}
          />
        </Field>
      </Section>

      <Section
        title="Images & vision"
        hint="How attached images reach the model. Staged copies always remain readable to the agent via its file tools."
      >
        <Field
          id="attVision"
          label="Send images to the model"
          hint="Attach raster images (png, jpg, gif, webp) as vision content so the model can see them. Claude models only — Cursor runs receive the file manifest instead."
        >
          <Toggle
            checked={attachments.images.attachAsVision}
            onChange={(v) => void update({ attachments: { images: { attachAsVision: v } } })}
          />
        </Field>
        {attachments.images.attachAsVision && (
          <Field
            id="attDownscale"
            label="Downscale above"
            hint="Larger images are resized before the vision send (the API caps images at 5 MB)."
          >
            <Select<number>
              value={clamp(
                attachments.images.downscaleThresholdMB,
                A.downscaleThresholdMB.min,
                A.downscaleThresholdMB.max,
              )}
              options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} MB` }))}
              onChange={(v) => void update({ attachments: { images: { downscaleThresholdMB: v } } })}
            />
          </Field>
        )}
      </Section>

      <Section
        title="Integration"
        hint="How attachments participate in the rest of the workspace."
      >
        <Field
          id="attAutoIndex"
          label="Index into Search"
          hint="Make text attachments findable through Global Search (reserved — indexing lands in a future update)."
        >
          <Toggle
            checked={attachments.autoIndex}
            onChange={(v) => void update({ attachments: { autoIndex: v } })}
          />
        </Field>
      </Section>
    </div>
  );
}
