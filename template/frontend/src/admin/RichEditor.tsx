import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";

export function RichEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        codeBlock: false,
        blockquote: false,
        italic: false,
        strike: false,
        underline: false,
        code: false,
        horizontalRule: false,
        orderedList: false,
        link: { openOnClick: false },
      }),
      Markdown,
      TableKit,
    ],
    content: value,
    contentType: "markdown",
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: {
      attributes: { "aria-label": "页面正文", class: "admin-prose" },
    },
  });
  if (!editor) return <p>编辑器加载中…</p>;
  return (
    <div className={"rich-editor" + (disabled ? " rich-editor--disabled" : "")}>
      <div className="editor-toolbar" role="toolbar" aria-label="正文格式">
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().setParagraph().run()}
        >
          正文
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          章节标题
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          小标题
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          加粗
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          列表
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            const href = window.prompt(
              "链接地址（https://… 或本站 /…）",
              editor.getAttributes("link").href || "",
            );
            if (href === null) return;
            if (!href) editor.chain().focus().unsetLink().run();
            else if (/^(https:\/\/|mailto:|tel:|\/(?!\/))/.test(href))
              editor
                .chain()
                .focus()
                .extendMarkRange("link")
                .setLink({ href })
                .run();
          }}
        >
          链接
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          插入表格
        </button>
        {editor.isActive("table") && (
          <>
            <button
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              加一行
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              加一列
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteRow().run()}
            >
              删除行
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteColumn().run()}
            >
              删除列
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              删除表格
            </button>
          </>
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().undo().run()}
        >
          撤销
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => editor.chain().focus().redo().run()}
        >
          重做
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
