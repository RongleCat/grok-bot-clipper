import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent } from "@/components/ui/message"

/*
 * align="end" is the whole mechanism for an outgoing turn: Message writes it
 * out as data-align and reverses its own flex row, so no ms-auto is needed.
 */
export function Pattern() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <Message>
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent>
              Staging is green on 4.2. Want me to promote it?
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>

      {/*
        Side alone is the first cue lost when a thread is read aloud or
        collapsed into one column, so the bubble variant carries it too.
      */}
      <Message align="end">
        <MessageContent>
          <Bubble>
            <BubbleContent>
              Hold it. The billing migration has to go out in the same release.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>

      <Message>
        <MessageContent>
          <Bubble variant="muted">
            <BubbleContent>
              Understood. The migration lands after the 2pm review.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>

      <Message align="end">
        <MessageContent>
          <Bubble>
            <BubbleContent>
              Then I will cut the tag straight after.
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  )
}