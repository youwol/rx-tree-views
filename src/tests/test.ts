import { attr$, child$, render } from '@youwol/flux-view'
import { BehaviorSubject, ReplaySubject, Subject } from 'rxjs'
import { create, SnapshotPlugin } from 'rxjs-spy'

import * as Match from 'rxjs-spy/cjs/match'
import { tag } from 'rxjs-spy/cjs/operators'

import { filter, mergeMap, take, tap } from 'rxjs/operators'
import { v4 as uuidv4 } from 'uuid'
import { ImmutableTree } from '../index'

const spy = create()
// There is a lot of warning about cyclic dependencies...apparently it's still fine
console.warn = (..._) => {}
beforeEach(() => {
    spy.flush()
    document.body.innerHTML = ''
})

function getOpenSubscriptions() {
    const snapshotPlugin = spy.find(SnapshotPlugin)

    const snapshot = snapshotPlugin['snapshotAll']()
    const matched = Array.from(snapshot.observables.values()).filter(function (
        observableSnapshot,
    ) {
        return Match.matches(observableSnapshot['observable'], /.+/)
    })

    return matched
        .map((match) => {
            const keys = match.subscriptions.keys()
            const openSubscriptions = Array.from(keys).filter((element) => {
                return !element.closed
            })
            return { tag: match.tag, openSubscriptions }
        })
        .reduce(
            (acc, e) => ({
                ...acc,
                ...{ [e.tag]: e.openSubscriptions.length },
            }),
            {},
        )
}

class Node extends ImmutableTree.Node {
    name: string
    renaming$ = new BehaviorSubject<boolean>(false)
    faClass: string
    constructor({ id, name, children, faClass }) {
        super({ id, children })
        this.name = name
        // renaming observable: true = node is being renamed, false = node not being renamed
        this.renaming$ = new BehaviorSubject(false)
        // FontAwesome class for icon, usually I try to separate view concerns from here, it is a shortcut
        this.faClass = faClass
    }
}
class DriveNode extends Node {
    constructor({ id, name, children }) {
        super({ id, name, children, faClass: 'fa-hdd' })
    }
}
class FolderNode extends Node {
    constructor({ id, name, children }) {
        super({ id, name, children, faClass: 'fa-folder' })
    }
}
class FileNode extends Node {
    constructor({ id, name }) {
        super({ id, name, children: undefined, faClass: 'fa-file' })
    }
}

const parse = (id, node) => {
    const factory = { drive: DriveNode, folder: FolderNode, file: FileNode }
    const children =
        node.children &&
        Object.entries(node.children).map(([id, child]) => {
            return parse(id, child)
        })
    return new factory[node.type]({ id, name: node.name, children })
}

test('subscriptions are closed', (done) => {
    const data = {
        name: 'Drive',
        type: 'drive',
        children: {
            folderA: {
                name: 'FolderA',
                type: 'folder',
                children: {
                    file1: { name: 'File1', type: 'file' },
                    file2: { name: 'File2', type: 'file' },
                },
            },
        },
    }

    const rootNode = parse('drive', data)
    const state = new ImmutableTree.State<Node>({ rootNode })
    const classSubject = new BehaviorSubject<string>('toto')
    const childSubject = new ReplaySubject<{ id: string; tag: string }>(1)
    const headerView = (state, node) => {
        return {
            id: `header-${node.id}`,
            innerText: node.name,
            class: attr$(classSubject.pipe(tag('class_' + node.id)), (d) => d, {
                wrapper: (d) => 'test-header ' + d,
            }),
            children: [
                child$(
                    childSubject.pipe(
                        filter(({ id }) => id == node.id),
                        tag('child_' + node.id),
                    ),
                    (d) => ({
                        class: attr$(
                            classSubject.pipe(tag('class_child_' + node.id)),
                            (c) => c + ' ' + d.tag,
                        ),
                        innerText: 'child ' + d,
                    }),
                ),
            ],
        }
    }
    state.root$.pipe(take(1)).subscribe((root) => {
        expect(root).toBeInstanceOf(DriveNode)
        const children = root.children as Array<Node>
        expect(children.length).toEqual(1)
        state.addChild(
            root,
            new FolderNode({ id: 'folderB', name: 'FolderB', children: [] }),
        )
    })
    state.root$.pipe(take(1)).subscribe((root) => {
        expect(root === rootNode).toBeFalsy()
        expect(root).toBeInstanceOf(DriveNode)
        const children = root.children as Array<Node>
        expect(children.length).toEqual(2)

        const folder = state.getNode('folderB')
        expect(folder).toBeTruthy()
    })

    const view = new ImmutableTree.View<Node>({
        state,
        headerView,
        id: 'tree-view',
        disconnectedCallback: () => state.unsubscribe(),
    })

    const div = render(view)
    document.body.appendChild(div)

    const root = document.getElementById('tree-view')
    expect(root).toBeTruthy()
    let headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(1)

    document
        .getElementById('header-drive')
        .dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }))
    headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(3) // drive +  folderA + folderB

    const handle = root.querySelector('.fv-tree-expand')
    expect(handle).toBeTruthy()
    handle.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }))
    handle.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }))

    headers.forEach((header) => {
        expect(header.classList.contains('toto')).toBeTruthy()
    })
    let subs = getOpenSubscriptions()
    expect(subs['class_drive']).toEqual(1)
    expect(subs['class_folderA']).toEqual(1)
    expect(subs['class_folderB']).toEqual(1)
    expect(subs['child_drive']).toEqual(1)
    expect(subs['child_folderA']).toEqual(1)
    expect(subs['child_folderB']).toEqual(1)

    classSubject.next('tutu')
    headers.forEach((header) => {
        expect(header.classList.contains('tutu')).toBeTruthy()
    })

    state.removeNode('folderA')
    headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(2)
    subs = getOpenSubscriptions()
    expect(subs['class_folderA']).toEqual(0)
    expect(subs['child_folderA']).toEqual(0)

    childSubject.next({ id: 'folderB', tag: 'first-test' })
    subs = getOpenSubscriptions()
    expect(subs['class_child_folderB']).toEqual(1)
    const firstTestChild = document
        .getElementById('header-folderB')
        .querySelector('.tutu.first-test')
    expect(firstTestChild).toBeTruthy()

    classSubject.next('tata')
    expect(firstTestChild.classList.contains('tata')).toBeTruthy()

    childSubject.next({ id: 'folderB', tag: 'second-test' })
    let secondTestChild = document
        .getElementById('header-folderB')
        .querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()

    subs = getOpenSubscriptions()
    expect(subs['class_child_folderB']).toEqual(1)

    state.replaceAttributes('folderB', { name: 'folderB-bis' })
    let folderB = document.getElementById('header-folderB')
    expect(folderB).toBeTruthy()
    const text = root.querySelector('#header-folderB')['innerText']
    expect(text).toEqual('folderB-bis')

    secondTestChild = folderB.querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()

    state.replaceNode(
        'folderB',
        new FileNode({ id: 'new-file', name: 'new file' }),
    )
    let file = root.querySelector('#header-new-file')
    expect(file).toBeTruthy()

    subs = getOpenSubscriptions()
    let open = Object.entries(subs).filter(([_k, v]) => v > 0)
    expect(open.length).toEqual(4)

    state.undo()
    file = root.querySelector('#header-new-file')
    expect(file).toBeFalsy()
    folderB = document.getElementById('header-folderB')
    secondTestChild = folderB.querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()
    subs = getOpenSubscriptions()

    expect(subs['class_drive']).toEqual(1)
    expect(subs['class_folderA']).toEqual(0)
    expect(subs['class_new-file']).toEqual(0)
    expect(subs['class_folderB']).toEqual(1)
    expect(subs['child_drive']).toEqual(1)
    expect(subs['child_folderA']).toEqual(0)
    expect(subs['child_folderB']).toEqual(1)
    expect(subs['class_child_folderB']).toEqual(1)
    expect(subs['child_new-file']).toEqual(0)

    state.redo()
    file = root.querySelector('#header-new-file')
    expect(file).toBeTruthy()
    subs = getOpenSubscriptions()
    open = Object.entries(subs).filter(([_k, v]) => v > 0)
    expect(open.length).toEqual(4)
    expect(subs['class_drive']).toEqual(1)
    expect(subs['class_new-file']).toEqual(1)
    expect(subs['child_drive']).toEqual(1)
    expect(subs['child_new-file']).toEqual(1)

    const s = state['subscriptions']
    expect(s.closed).toEqual(false)
    root.remove()
    subs = getOpenSubscriptions()
    open = Object.entries(subs).filter(([_k, v]) => v > 0)
    expect(open.length).toEqual(0)

    expect(s.closed).toEqual(true)
    done()
})

test('async rendering', (done) => {
    const children$ = new Subject<Array<Node>>()
    const drive = new DriveNode({
        id: 'drive',
        name: 'drive',
        children: [
            new FolderNode({
                id: 'folderA',
                name: 'FolderA',
                children: children$,
            }),
        ],
    })

    const state = new ImmutableTree.State<Node>({
        rootNode: drive,
        expandedNodes: ['drive', 'folderA'],
    })
    const headerView = (state, node) => {
        return { id: `header-${node.id}`, innerText: node.name }
    }
    const view = new ImmutableTree.View<Node>({
        state,
        headerView,
        id: 'tree-view',
    })

    const div = render(view)
    document.body.appendChild(div)

    const root = document.getElementById('tree-view')
    expect(root).toBeTruthy()
    const folderA = root.querySelector('#header-folderA')
    expect(folderA).toBeTruthy()

    children$.next([new FileNode({ id: 'fileA', name: 'FileA' })])
    const fileA = root.querySelector('#header-fileA')
    expect(fileA).toBeTruthy()

    const children = drive.children[0].resolvedChildren()
    expect(children[0].id).toEqual('fileA')

    const path = state.reducePath(children[0], (node) => node.id)
    expect(path).toEqual(['drive', 'folderA', 'fileA'])

    view.contextMenu$.subscribe(({ data }) => {
        expect(data.node).toEqual(
            ImmutableTree.find(drive, (n) => n.id == 'fileA'),
        )
        done()
    })
    fileA.dispatchEvent(
        new MouseEvent('contextmenu', { button: 2, bubbles: true }),
    )
})

test('commands', (done) => {
    const children$ = new Subject<Array<Node>>()
    const drive = new DriveNode({
        id: 'drive',
        name: 'drive',
        children: [],
    })

    const state = new ImmutableTree.State<Node>({ rootNode: drive })
    new ImmutableTree.InitCommand({}).execute(state)

    const uuid = uuidv4()
    const uuidInserted = uuidv4()
    const commands = [
        {
            id: 'add-child',
            command: () => {
                return new ImmutableTree.AddChildCommand(
                    drive,
                    new FolderNode({
                        id: 'folderA',
                        name: 'FolderA',
                        children: children$,
                    }),
                )
            },
            thenExpect: (root) => {
                const folderA = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA',
                )
                expect(folderA.id).toEqual('folderA')
            },
        },
        {
            id: 'replace-attributes',
            command: (root) => {
                const folderA = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA',
                )
                return new ImmutableTree.ReplaceAttributesCommand(folderA, {
                    name: 'FolderA-bis',
                })
            },
            thenExpect: (root) => {
                const folderA = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA',
                )
                expect(folderA.name).toEqual('FolderA-bis')
            },
        },
        {
            id: 'replace-node',
            command: (root) => {
                const folderA = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA',
                )
                return new ImmutableTree.ReplaceNodeCommand(
                    folderA,
                    new FileNode({ id: uuid, name: 'file' }),
                )
            },
            thenExpect: (root) => {
                const file = ImmutableTree.find(root, (n) => n.id == uuid)
                expect(file.name).toEqual('file')
            },
        },
        {
            id: 'insert-child',
            command: (root) => {
                const drive = ImmutableTree.find(root, (n) => n.id == 'drive')
                return new ImmutableTree.InsertChildCommand(
                    { parent: drive, insertIndex: 0 },
                    new FileNode({ id: uuidInserted, name: 'inserted' }),
                )
            },
            thenExpect: (root) => {
                const rootChildren = root.resolvedChildren()
                expect(rootChildren.length).toEqual(2)
                expect(rootChildren[0].id).toEqual(uuidInserted)
                expect(rootChildren[1].id).toEqual(uuid)
            },
        },
        {
            id: 'move-child',
            command: (root) => {
                const drive = ImmutableTree.find(root, (n) => n.id == 'drive')
                const inserted = ImmutableTree.find(
                    root,
                    (n) => n.id == uuidInserted,
                )
                return new ImmutableTree.MoveNodeCommand(inserted, {
                    reference: drive,
                })
            },
            thenExpect: (root) => {
                const rootChildren = root.resolvedChildren()
                expect(rootChildren.length).toEqual(2)
                expect(rootChildren[0].id).toEqual(uuid)
                expect(rootChildren[1].id).toEqual(uuidInserted)
            },
        },
        {
            id: 'remove-node',
            command: (root) => {
                const file = ImmutableTree.find(root, (n) => n.id == uuid)
                return new ImmutableTree.RemoveNodeCommand(
                    file,
                    new FileNode({ id: uuid, name: 'file' }),
                )
            },
            thenExpect: (root) => {
                const rootChildren = root.resolvedChildren()
                expect(rootChildren.length).toEqual(1)
                expect(rootChildren[0].id).toEqual(uuidInserted)
            },
        },
    ]
    const selectedCommands = [...commands]
    selectedCommands.forEach(({ command, thenExpect }) => {
        state.root$.pipe(take(1)).subscribe((root) => {
            command(root).execute(state)
        })
        state.root$.pipe(take(1)).subscribe((root) => {
            thenExpect(root)
        })
    })
    expect(state['historic']).toHaveLength(selectedCommands.length + 1)
    let previousCommand = undefined
    selectedCommands.reverse().forEach((command) => {
        if (previousCommand) {
            state.root$.pipe(take(1)).subscribe((root) => {
                command.thenExpect(root)
            })
        }
        state.undo()
        previousCommand = command
    })
    state.root$.pipe(take(1)).subscribe((root) => {
        expect(root.children).toEqual([])
    })
    selectedCommands.reverse().forEach(({ thenExpect }, index) => {
        state.redo()
        state.root$.pipe(take(1)).subscribe((root) => {
            thenExpect(root)
            if (index == selectedCommands.length - 1) {
                done()
            }
        })
    })
})

test('modifying node on resolved parent', (done) => {
    const children$ = new BehaviorSubject<Array<Node>>([])
    const drive = new DriveNode({
        id: 'drive',
        name: 'drive',
        children: [
            new FolderNode({
                id: 'folderA',
                name: 'FolderA',
                children: children$,
            }),
        ],
    })
    const headerView = (state, node) => {
        return { id: `header-${node.id}`, innerText: node.name }
    }
    const state = new ImmutableTree.State<Node>({
        rootNode: drive,
        expandedNodes: ['drive'],
    })
    new ImmutableTree.InitCommand({}).execute(state)

    const view = new ImmutableTree.View<Node>({
        state,
        headerView,
        id: 'tree-view',
        disconnectedCallback: () => state.unsubscribe(),
    })

    const div = render(view)
    document.body.appendChild(div)
    const rootView = document.getElementById('tree-view')
    expect(rootView).toBeTruthy()
    const folderAView = rootView.querySelector('#header-folderA')
    expect(folderAView).toBeTruthy()

    const folderANode = state.getNode('folderA')
    expect(folderANode).toBeTruthy()

    folderAView.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    const children2$ = new Subject<Array<Node>>()
    const commands = [
        {
            id: 'add-child',
            command: (_root) => {
                return new ImmutableTree.AddChildCommand(
                    folderANode,
                    new FolderNode({
                        id: 'folderA1',
                        name: 'FolderA1',
                        children: children$,
                    }),
                )
            },
            thenExpect: (root) => {
                const folderA1 = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA1',
                )
                expect(folderA1).toBeTruthy()
                const folderA1View = rootView.querySelector('#header-folderA1')
                expect(folderA1View).toBeTruthy()
            },
        },
        {
            id: 'replace-child',
            command: (_root) => {
                return new ImmutableTree.ReplaceNodeCommand(
                    folderANode,
                    new FolderNode({
                        ...folderANode,
                        name: 'folderA bis',
                        children: children2$,
                    } as any),
                )
            },
            thenExpect: (root) => {
                const folderReplaced = ImmutableTree.find(
                    root,
                    (n) => n.id == 'folderA',
                )
                children2$.next([])
                expect(folderReplaced).toBeTruthy()
                const folderReplacedView =
                    rootView.querySelector('#header-folderA')
                expect(folderReplacedView).toBeTruthy()
                expect(folderReplaced.children).toEqual([])
                //expect(true).toBeFalsy()
            },
        },
    ]
    commands.forEach(({ command, thenExpect }, index) => {
        state.root$.pipe(take(1)).subscribe((root) => {
            command(root).execute(state)
        })
        state.root$.pipe(take(1)).subscribe((root) => {
            thenExpect(root)
            if (index == commands.length - 1) {
                done()
            }
        })
    })
})

test('resolve path', (done) => {
    const childrenFolderB$ = new ReplaySubject<Array<Node>>()

    const drive = new DriveNode({
        id: 'drive',
        name: 'drive',
        children: [
            new FolderNode({
                id: 'folderA',
                name: 'FolderA',
                children: new BehaviorSubject<Array<Node>>([
                    new FolderNode({
                        id: 'folderB',
                        name: 'FolderB',
                        children: childrenFolderB$,
                    }),
                ]),
            }),
        ],
    })
    const headerView = (state, node) => {
        return { id: `header-${node.id}`, innerText: node.name }
    }
    const state = new ImmutableTree.State<Node>({
        rootNode: drive,
    })
    new ImmutableTree.InitCommand({}).execute(state)

    const view = new ImmutableTree.View<Node>({
        state,
        headerView,
        id: 'tree-view',
        disconnectedCallback: () => state.unsubscribe(),
    })

    const div = render(view)
    document.body.appendChild(div)
    const rootView = document.getElementById('tree-view')
    expect(rootView).toBeTruthy()
    let folderAView = rootView.querySelector('#header-folderA')
    expect(folderAView).toBeFalsy()

    let folderBView = rootView.querySelector('#header-folderB')
    expect(folderBView).toBeFalsy()
    childrenFolderB$.next([
        new FolderNode({
            id: 'folderC',
            name: 'FolderC',
            children: childrenFolderB$,
        }),
    ])
    state
        .resolvePath(['drive', 'folderA', 'folderB'])
        .pipe(
            mergeMap(() => state.root$),
            tap((root) => {
                expect(root.children[0].children[0].children[0].id).toBe(
                    'folderC',
                )
            }),
        )
        .subscribe(() => {
            state.expandedNodes$.next(['drive', 'folderA', 'folderB'])
            let folderAView = rootView.querySelector('#header-folderA')
            expect(folderAView).toBeTruthy()

            let folderBView = rootView.querySelector('#header-folderB')
            expect(folderBView).toBeTruthy()

            let folderCView = rootView.querySelector('#header-folderC')
            expect(folderCView).toBeTruthy()
            done()
        })
})

test('errors', () => {
    const drive = new DriveNode({
        id: 'drive',
        name: 'drive',
        children: [],
    })

    const state = new ImmutableTree.State<Node>({ rootNode: drive })
    expect(state.getNode('tutu')).toEqual(undefined)
    let fct = () =>
        state.addChild('tutu', new FileNode({ id: 'file', name: 'file' }))
    expect(fct).toThrow()
    fct = () => state.removeNode('tutu')
    expect(fct).toThrow()
    fct = () => state.replaceAttributes('tutu', {})
    expect(fct).toThrow()
    fct = () => state.replaceNode('tutu', {})
    expect(fct).toThrow()
})
