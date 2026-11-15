/** Limited value-bridge stand; document/selection acceptance uses the real editor. */
export function createRichEditorMock() {
    const { Schema } = jest.requireActual('@tiptap/pm/model');
    const { EditorState } = jest.requireActual('@tiptap/pm/state');
    const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] }, text: {} } });
    const mockEditor: any = {
        schema,
        options: {},
        state: EditorState.create({ schema }),
        view: { dispatch: jest.fn(), composing: false, hasFocus: jest.fn().mockReturnValue(false) },
        on: jest.fn(),
        off: jest.fn(),
        chain: jest.fn().mockReturnThis(),
        focus: jest.fn().mockReturnThis(),
        command: jest.fn().mockReturnThis(),
        setContent: jest.fn().mockReturnThis(),
        run: jest.fn().mockReturnValue(true),
        isActive: jest.fn().mockReturnValue(false),
        commands: { setContent: jest.fn() },
        storage: { markdown: { getMarkdown: jest.fn().mockReturnValue(''), parser: { parse: (value: string) => `<p>${value}</p>` } } },
        isEditable: true,
        setEditable: jest.fn(),
    };
    const { commands } = jest.requireActual('@tiptap/core');
    mockEditor.extensionManager = { commands: {
        command: (callback: any) => (props: any) => callback(props),
        setContent: (value: string, options: object) => (props: any) => {
            mockEditor.setContent(value, options);
            return commands.setContent(`<p>${value}</p>`, options)(props);
        },
    } };
    mockEditor.view.dispatch.mockImplementation((tr: any) => { mockEditor.state = mockEditor.state.apply(tr); });
    return mockEditor;
}
