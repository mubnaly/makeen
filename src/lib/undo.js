// Command-based undo/redo, maintained PER DOCUMENT (plan §6.4) so switching
// documents does not mix histories. Grouping is the caller's job: one continuous
// drag records a single command; text edits record one command when committed.

export function createUndoManager(limit = 300) {
  const byDoc = new Map();

  function stacks(id) {
    if (!byDoc.has(id)) byDoc.set(id, { undo: [], redo: [] });
    return byDoc.get(id);
  }

  function push(docId, command) {
    const s = stacks(docId);
    s.undo.push(command);
    if (s.undo.length > limit) s.undo.shift();
    s.redo.length = 0; // a new action invalidates the redo branch
  }

  function applyForward(list, command) {
    if (command.op === 'add') {
      return list.some((a) => a.id === command.ann.id) ? list : [...list, command.ann];
    }
    if (command.op === 'remove') {
      return list.filter((a) => a.id !== command.ann.id);
    }
    if (command.op === 'update') {
      return list.map((a) => (a.id === command.after.id ? command.after : a));
    }
    return list;
  }

  function applyBackward(list, command) {
    if (command.op === 'add') {
      return list.filter((a) => a.id !== command.ann.id);
    }
    if (command.op === 'remove') {
      return list.some((a) => a.id === command.ann.id) ? list : [...list, command.ann];
    }
    if (command.op === 'update') {
      return list.map((a) => (a.id === command.before.id ? command.before : a));
    }
    return list;
  }

  return {
    recordAdd(docId, ann) {
      push(docId, { op: 'add', ann });
    },
    recordRemove(docId, ann) {
      push(docId, { op: 'remove', ann });
    },
    recordUpdate(docId, before, after) {
      push(docId, { op: 'update', before, after });
    },
    canUndo(docId) {
      return stacks(docId).undo.length > 0;
    },
    canRedo(docId) {
      return stacks(docId).redo.length > 0;
    },
    // Returns { list, command } or null when nothing to do.
    undo(docId, list) {
      const s = stacks(docId);
      const command = s.undo.pop();
      if (!command) return null;
      const next = applyBackward(list, command);
      s.redo.push(command);
      return { list: next, command };
    },
    redo(docId, list) {
      const s = stacks(docId);
      const command = s.redo.pop();
      if (!command) return null;
      const next = applyForward(list, command);
      s.undo.push(command);
      return { list: next, command };
    },
    clear(docId) {
      byDoc.delete(docId);
    }
  };
}
