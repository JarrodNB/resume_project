# AGENTS.md — apps/web/src/components/dnd

## Purpose

Drag-and-drop building blocks on top of `@dnd-kit/react` (and `move` from `@dnd-kit/helpers`).
Features wrap their page or form in one `DragDropProvider` and decide what a drop changes.

## Contents

- `SortableItem.tsx` — one sortable item; passes its `DragHandle` to `children` to place
- `DragHandle.tsx` — grip button that starts a drag (pointer or keyboard)
- `SortableGroup.tsx` — drop area around one list, so items can land in an empty list
- `moveItems.ts` — pure helpers: `sortableId` / `sortableGroupId` / `idFromSortableId`,
  `reorderList`, `moveBetweenGroups`, `findItemLocation`, `projectedMove`
- `moveItems.test.ts` — helper tests (jsdom can't simulate drags, so logic lives in pure helpers)

## Local Rules

- Sortable ids must be unique within one `DragDropProvider`. Database ids of different kinds
  can be equal, so always build ids with `sortableId(kind, id)`.
- Give each kind of item a `type`; `SortableItem` only accepts its own type, so highlights land
  among highlights and skills among skills.
- Only the handle starts a drag, so inputs inside a sortable item keep working.
- Lists that items can move between (highlights across roles): keep the grouped ids in state,
  update them in `onDragOver` with `projectedMove` + `moveBetweenGroups`, restore on cancel,
  and commit in `onDragEnd`. Single lists: apply `projectedMove` in `onDragEnd` only.
