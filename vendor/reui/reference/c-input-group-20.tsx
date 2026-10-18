import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { IconPlaceholder } from "@/app/(create)/components/icon-placeholder"

export function Pattern() {
  return (
    <Field className="max-w-xs">
      <FieldLabel htmlFor="search-input">Search Components</FieldLabel>
      <InputGroup>
        <InputGroupAddon>
          <IconPlaceholder
            lucide="SearchIcon"
            tabler="IconSearch"
            hugeicons="Search01Icon"
            phosphor="MagnifyingGlassIcon"
            remixicon="RiSearchLine"
            className="text-muted-foreground"
          />
        </InputGroupAddon>
        <InputGroupInput id="search-input" placeholder="Search..." />
      </InputGroup>
    </Field>
  )
}