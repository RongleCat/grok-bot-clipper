import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"

// Icon names are hoisted static literals because the shadcn CLI rewrites them
// to whichever icon library the installer picked, and it can only rewrite a
// literal. A computed or spread prop value installs as a blank square.
const ICON_REPORT = (
  <IconPlaceholder
    lucide="FileTextIcon"
    tabler="IconFileText"
    hugeicons="File02Icon"
    phosphor="FileTextIcon"
    remixicon="RiFileTextLine"
    aria-hidden="true"
  />
)

const ICON_DOWNLOAD = (
  <IconPlaceholder
    lucide="DownloadIcon"
    tabler="IconDownload"
    hugeicons="Download01Icon"
    phosphor="DownloadSimpleIcon"
    remixicon="RiDownloadLine"
    aria-hidden="true"
  />
)

export function Pattern() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
      <p className="text-sm">
        Here is the cohort breakdown you asked for. Numbers run through 30
        September.
      </p>
      {/*
       * The root sizes to its own content, so a chip meant to fill the reply
       * column has to be told to stretch.
       */}
      <Attachment className="w-full">
        <AttachmentMedia>{ICON_REPORT}</AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>retention-cohorts-q3.pdf</AttachmentTitle>
          <AttachmentDescription>
            PDF
            <span
              aria-hidden="true"
              className="bg-muted-foreground/40 mx-1.5 inline-block size-1 rounded-full align-middle"
            />
            1.9 MB
          </AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          {/*
           * type="button" is spelled out because a bare <button> inside a form
           * defaults to submit, and this chip is meant to be pasted into one.
           */}
          <AttachmentAction
            type="button"
            size="icon-sm"
            variant="secondary"
            aria-label="Download retention-cohorts-q3.pdf"
          >
            {ICON_DOWNLOAD}
          </AttachmentAction>
        </AttachmentActions>
      </Attachment>
    </div>
  )
}