import { attr$, child$, VirtualDOM } from '@youwol/flux-view'
import {
    BehaviorSubject,
    Observable,
    of,
    ReplaySubject,
    Subject,
    Subscription,
} from 'rxjs'
import {
    distinct,
    filter,
    map,
    mergeMap,
    shareReplay,
    take,
    tap,
} from 'rxjs/operators'

export namespace ImmutableTree {
    /*
    Node are immutable hierarchical data structure
    */
    export class Node {
        public readonly children?: Array<Node> | Observable<Array<Node>>
        public readonly factory: any
        public readonly id: string

        constructor({
            id,
            children,
        }: {
            id: string
            children?: Array<Node> | Observable<Array<Node>>
        }) {
            this.id = id
            this.factory = this['__proto__'].constructor
            this.children = children
        }

        resolvedChildren(): Array<Node> {
            if (!this.children || this.children instanceof Observable)
                throw Error(
                    'Children are not defined or have no been resolved yet',
                )
            return this.children
        }

        resolveChildren(): Observable<Array<Node>> {
            if (!this.children) return
            if (Array.isArray(this.children)) return of(this.children)

            return this.children.pipe(
                take(1),
                tap((children: Array<Node>) => {
                    if (!children) {
                        return
                    }
                    const mutableThis = this as { children: Node[] }
                    mutableThis.children = children
                }),
                map((children) => children),
                shareReplay({ bufferSize: 1, refCount: true }),
            )
        }
    }

    export function find(node: Node, fct) {
        if (fct(node)) return node
        if (!node.children || node.children instanceof Observable) {
            return undefined
        }
        for (const child of node.children) {
            const target = find(child, fct)
            if (target) return target
        }
    }

    export interface Command<NodeType extends Node> {
        execute(
            tree: State<NodeType>,
            emitUpdate: boolean,
            updatePropagationFct,
        )
    }

    export class InitCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly data,
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            _emitUpdate = true,
            _updatePropagationFct = (_old) => ({}),
        ) {
            /* NOOP */
        }
    }

    export class AddChildCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly parentNode: NodeType,
            public readonly childNode: NodeType,
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.addChild(
                this.parentNode.id,
                this.childNode,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class InsertChildCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly destination: {
                parent: NodeType
                insertIndex?: number
            },
            public readonly childNode: NodeType,
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.insertChild(
                this.destination,
                this.childNode,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class RemoveNodeCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly parentNode: NodeType,
            public readonly removedNode: NodeType,
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.removeNode(
                this.removedNode.id,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class ReplaceNodeCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly oldNode: NodeType,
            public readonly newNode: NodeType,
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.replaceNode(
                this.oldNode.id,
                this.newNode,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class MoveNodeCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly movedNode: NodeType,
            public readonly destination: {
                reference: NodeType
                direction?: 'above' | 'below'
            },
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.moveNode(
                this.movedNode.id,
                this.destination,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class ReplaceAttributesCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly node: NodeType,
            public readonly attributes: { [key: string]: any },
            public readonly metadata: any = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
        ) {
            return tree.replaceAttributes(
                this.node.id,
                this.attributes,
                emitUpdate,
                updatePropagationFct,
            )
        }
    }

    export class Updates<NodeType extends Node> {
        replacedNodes: Array<NodeType>

        constructor(
            public readonly removedNodes: Array<NodeType>,
            public readonly addedNodes: Array<NodeType>,
            public readonly newTree: NodeType,
            public readonly command: Command<NodeType>,
        ) {
            this.replacedNodes = addedNodes.filter((newNode) =>
                removedNodes.find((oldNode) => oldNode.id == newNode.id),
            )
        }
    }

    export class State<NodeType extends Node> {
        public readonly root$ = new ReplaySubject<NodeType>(1)
        public readonly children$ = new Map<
            NodeType,
            ReplaySubject<Array<NodeType>>
        >()
        public readonly directUpdates$ = new ReplaySubject<
            Array<Updates<NodeType>>
        >()

        private root: NodeType
        private parents: { [key: string]: NodeType }
        private tmpUpdates = new Array<Updates<NodeType>>()
        private historic = new Array<NodeType>()
        private currentIndex = 0
        private subscriptions = new Subscription()
        expandedNodes$: BehaviorSubject<Array<string>> = new BehaviorSubject<
            Array<string>
        >([])
        selectedNode$: ReplaySubject<NodeType>

        constructor({
            rootNode,
            emitUpdate,
            expandedNodes,
            selectedNode,
        }: {
            rootNode: NodeType
            emitUpdate?: boolean
            expandedNodes?: Array<string> | BehaviorSubject<Array<string>>
            selectedNode?: ReplaySubject<NodeType>
        }) {
            emitUpdate = emitUpdate != undefined ? emitUpdate : true

            this.selectedNode$ =
                selectedNode instanceof ReplaySubject
                    ? selectedNode
                    : new ReplaySubject<NodeType>(1)

            this.expandedNodes$ =
                expandedNodes instanceof BehaviorSubject
                    ? expandedNodes
                    : new BehaviorSubject<Array<string>>(expandedNodes || [])

            this.subscriptions.add(
                this.root$
                    .pipe(filter((node) => node != undefined))
                    .subscribe((root: NodeType) => {
                        this.root = root
                        this.children$.set(root, new ReplaySubject(1))

                        const indexHistory = this.historic.indexOf(root)
                        if (indexHistory == -1) {
                            if (this.currentIndex < this.historic.length - 1)
                                this.historic = this.historic.slice(
                                    0,
                                    this.currentIndex + 1,
                                )
                            this.historic.push(root)
                            this.currentIndex = this.historic.length - 1
                            return
                        }
                        this.currentIndex = indexHistory
                    }),
            )
            if (rootNode) this.reset(rootNode, emitUpdate)
        }

        reset(root: NodeType, emitUpdate = true) {
            this.parents = {}
            this.historic = []
            this.currentIndex = 0
            this.setParentRec(root, undefined)
            this.root = root
            const update = new Updates([], [], this.root, new InitCommand(root))
            this.tmpUpdates.push(update)

            if (emitUpdate) this.emitUpdate()
        }

        unsubscribe() {
            this.subscriptions.unsubscribe()
        }

        getParent(nodeId: string): NodeType {
            return this.parents[nodeId]
        }

        reducePath<PathType>(
            start: string | NodeType,
            extractFct: (node: NodeType) => PathType,
        ): Array<PathType> {
            if (start == undefined) return []

            const node = start instanceof Node ? start : this.getNode(start)

            return this.reducePath(this.getParent(node.id), extractFct).concat([
                extractFct(node),
            ])
        }

        getChildren(
            node: NodeType,
            then?: (node: NodeType, children: Array<NodeType>) => void,
        ) {
            if (!node.children) return

            if (Array.isArray(node.children)) {
                this.getChildren$(node).next(node.children as NodeType[])
                return
            }
            this.subscriptions.add(
                node.resolveChildren().subscribe((children: NodeType[]) => {
                    if (!children) return
                    children.forEach((child) => this.setParentRec(child, node))
                    this.getChildren$(node).next(children)
                    then && then(node, children)
                }),
            )
        }

        getChildren$(node: NodeType) {
            if (!this.children$.has(node))
                this.children$.set(node, new ReplaySubject(1))

            return this.children$.get(node)
        }

        undo() {
            if (this.currentIndex == 0) return
            this.root$.next(this.historic[this.currentIndex - 1])
        }

        redo() {
            if (this.currentIndex == this.historic.length - 1) return
            this.root$.next(this.historic[this.currentIndex + 1])
        }

        getNode<T = NodeType>(id): T {
            if (id == this.root.id) return this.root as unknown as T

            const parent = this.parents[id] || this.root

            if (!parent.children || parent.children instanceof Observable) {
                throw Error(' Can not get node od unresolved parent')
            }
            return parent.children.find((node) => node.id == id) as unknown as T
        }

        addChild(
            parent: string | NodeType,
            childNode: NodeType,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata = undefined,
        ) {
            const { parentNode } = this.insertChildBase(
                { parent },
                childNode,
                updatePropagationFct,
            )
            const update = new Updates(
                [],
                [childNode],
                this.root,
                new AddChildCommand(parentNode, childNode, cmdMetadata),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        insertChild(
            destination: { parent: string | NodeType; insertIndex?: number },
            childNode: NodeType,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata = undefined,
        ) {
            const { parentNode } = this.insertChildBase(
                destination,
                childNode,
                updatePropagationFct,
            )
            const update = new Updates(
                [],
                [childNode],
                this.root,
                new InsertChildCommand(
                    {
                        parent: parentNode,
                        insertIndex: destination.insertIndex,
                    },
                    childNode,
                    cmdMetadata,
                ),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        private insertChildBase(
            destination: { parent: string | NodeType; insertIndex?: number },
            childNode: NodeType,
            updatePropagationFct,
        ) {
            const parentNode =
                destination.parent instanceof Node
                    ? destination.parent
                    : this.getNode(destination.parent)

            if (!parentNode)
                throw Error('Can not find the parent to add the child')

            if (
                !parentNode.children ||
                parentNode.children instanceof Observable
            )
                throw Error(
                    'You can not add a child to a node not already resolved',
                )

            const newChild = new childNode.factory({
                ...childNode,
                ...updatePropagationFct(childNode),
            }) as NodeType
            const newChildren = [
                ...parentNode.children.filter(
                    (child) => child.id != newChild.id,
                ),
            ]
            const index = destination.insertIndex ?? parentNode.children.length
            newChildren.splice(index, 0, newChild)

            const newParent = new parentNode.factory({
                ...parentNode,
                ...{ children: newChildren },
                ...updatePropagationFct(parentNode),
            })
            newParent.children.forEach((child) =>
                this.setParentRec(child, newParent),
            )
            this.root = this.cloneTreeAndReplacedChild(
                parentNode,
                newParent,
                updatePropagationFct,
            )
            return { parentNode }
        }

        removeNode(
            target: string | NodeType,
            emitUpdate = true,
            _updatePropagationFct = (_old) => ({}),
            cmdMetadata: any = undefined,
        ) {
            const { newParent, node } = this.removeNodeBase(target)

            const update = new Updates(
                [node],
                [],
                this.root,
                new RemoveNodeCommand(newParent, node, cmdMetadata),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        private removeNodeBase(target: string | NodeType) {
            const node = target instanceof Node ? target : this.getNode(target)

            if (!node) throw Error('Can not find the node to remove')

            const parentNode = this.parents[node.id]

            if (!parentNode)
                throw Error('Can not find the parent of the node to remove')

            if (
                !parentNode.children ||
                parentNode.children instanceof Observable
            )
                throw Error(
                    'You can not remove a child from a node not already resolved',
                )

            const newParent = new parentNode.factory({
                ...parentNode,
                ...{
                    children: parentNode.children.filter(
                        (child) => child.id != node.id,
                    ),
                },
            })

            delete this.parents[node.id]
            newParent.children &&
                newParent.children.forEach(
                    (c) => (this.parents[c.id] = newParent),
                )

            this.children$.has(node) && this.children$.delete(node)

            this.root = this.cloneTreeAndReplacedChild(
                parentNode,
                newParent,
                (_old) => ({}),
            )
            return { newParent, node }
        }

        replaceNode(
            target: string | NodeType,
            newNode,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: any = undefined,
        ) {
            const oldNode =
                target instanceof Node ? target : this.getNode(target)

            if (!oldNode) throw Error('Can not find the node to remove')

            Array.isArray(newNode.children) &&
                newNode.children.forEach((child) =>
                    this.setParentRec(child, newNode),
                )

            this.root = this.cloneTreeAndReplacedChild(
                oldNode,
                newNode,
                updatePropagationFct,
            )
            const update = new Updates(
                [oldNode],
                [newNode],
                this.root,
                new ReplaceNodeCommand(oldNode, newNode, cmdMetadata),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        /**
         * @param target the node to move
         * @param destination
         * @param destination.reference a node used as reference
         * @param destination.direction
         *   * if 'above': put the node above the reference
         *   * if 'below'; put the node below the reference
         *   * if 'none': add the node as child of reference
         * @param emitUpdate whether or not to notify the update
         * @param updatePropagationFct a function that is called to append properties on node
         * @param cmdMetadata metadata to add to the command
         * */
        moveNode(
            target: string | NodeType,
            destination: {
                reference: string | NodeType
                direction?: 'above' | 'below'
            },
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: any = undefined,
        ) {
            const movedNode =
                target instanceof Node ? target : this.getNode(target)

            this.removeNodeBase(movedNode)
            const reference =
                destination.reference instanceof Node
                    ? destination.reference
                    : this.getNode(destination.reference)

            let parentNode = destination.direction
                ? this.getParent(reference.id)
                : reference

            if (!destination.direction) {
                this.insertChildBase(
                    { parent: parentNode },
                    movedNode,
                    updatePropagationFct,
                )
            } else {
                const resolvedChildren = parentNode.resolvedChildren()
                const insertIndex =
                    resolvedChildren.indexOf(reference) +
                    (destination.reference == 'above' ? -1 : 0)
                this.insertChildBase(
                    { parent: parentNode, insertIndex },
                    movedNode,
                    updatePropagationFct,
                )
            }

            const update = new Updates(
                [movedNode],
                [this.getNode(movedNode.id)],
                this.root,
                new MoveNodeCommand(
                    movedNode,
                    {
                        reference: this.getNode(reference.id),
                        direction: destination.direction,
                    },
                    cmdMetadata,
                ),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        replaceAttributes(
            target: string | NodeType,
            newAttributes,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: any = undefined,
        ) {
            const node = target instanceof Node ? target : this.getNode(target)

            if (!node) throw Error('Can not find the node to remove')

            const newNode = new node.factory({
                ...node,
                ...newAttributes,
                ...updatePropagationFct(node),
            }) as NodeType
            newNode.children &&
                newNode.children.forEach((c) => (this.parents[c.id] = newNode))
            this.root = this.cloneTreeAndReplacedChild(
                node,
                newNode,
                updatePropagationFct,
            )
            const update = new Updates(
                [node],
                [newNode],
                this.root,
                new ReplaceAttributesCommand(node, newAttributes, cmdMetadata),
            )
            this.tmpUpdates.push(update)

            emitUpdate && this.emitUpdate()

            return { root: this.root, update }
        }

        emitUpdate() {
            this.root$.next(this.root)
            this.directUpdates$.next(this.tmpUpdates)
            this.tmpUpdates = []
        }

        resolvePath(path: string[]): Observable<NodeType[]> {
            let resolveChildrenRec = () => {
                return (
                    source$: Observable<{
                        index: number
                        nodesResolved: NodeType[]
                    }>,
                ) => {
                    return source$.pipe(
                        take(1),
                        mergeMap(({ index, nodesResolved }) => {
                            if (index == path.length) {
                                return of(nodesResolved)
                            }
                            const node = this.getNode(path[index])
                            this.getChildren(node)
                            return this.getChildren$(node).pipe(
                                take(1),
                                map(() => {
                                    return {
                                        index: index + 1,
                                        nodesResolved: [...nodesResolved, node],
                                    }
                                }),
                                resolveChildrenRec(),
                            )
                        }),
                    )
                }
            }
            const indexUnresolved = path.findIndex(
                (childId) => this.getNode(childId) == undefined,
            )
            return of({
                index: Math.max(0, indexUnresolved - 1),
                nodesResolved: [],
            }).pipe(resolveChildrenRec())
        }

        private cloneTreeAndReplacedChild(
            oldChild: NodeType,
            newChild: NodeType,
            updatePropagationFct,
        ): NodeType {
            const oldParent = this.parents[oldChild.id]
            if (oldParent == undefined) return newChild

            if (!oldParent.children || oldParent.children instanceof Observable)
                throw Error(
                    'You can not add a child to a node not already resolved',
                )

            const newParent = new oldParent.factory({
                ...oldParent,
                ...{
                    children: oldParent.children.map((child) =>
                        child.id == oldChild.id ? newChild : child,
                    ),
                },
                ...updatePropagationFct(oldParent),
            })
            newParent.children.forEach(
                (child) => (this.parents[child.id] = newParent),
            )

            if (this.children$.has(oldChild)) {
                this.children$.delete(oldChild)
                this.getChildren$(newChild)
            }

            return this.cloneTreeAndReplacedChild(
                oldParent,
                newParent,
                updatePropagationFct,
            )
        }

        private setParentRec(node: NodeType, parentNode: NodeType | undefined) {
            this.parents[node.id] = parentNode
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child) =>
                    this.setParentRec(child as NodeType, node),
                )
            }
        }

        selectNodeAndExpand(node: NodeType): void {
            this.selectedNode$.next(node)

            // Expand tree to show this node. This could (should ?) be implemented in immutable-tree.view.ts
            const ensureExpanded: string[] = [node.id]

            // Ensure parents nodes are also expanded
            let parent = this.getParent(node.id)
            while (parent != undefined) {
                ensureExpanded.push(parent.id)
                parent = this.getParent(parent.id)
            }
            // Put parents at the begin
            ensureExpanded.reverse()

            // Currently expanded nodes
            const actualExpanded = this.expandedNodes$.getValue()

            // One-liner for filtering unique values of an array
            const arrayUniq = (v, i, s) => s.indexOf(v) === i
            // What we want
            const expectedExpanded = actualExpanded
                .concat(ensureExpanded)
                .filter(arrayUniq)

            // Update tree expanded nodes
            this.expandedNodes$.next(expectedExpanded)
        }
    }

    //-------------------------------------------------------------------------
    //-------------------------------------------------------------------------
    export type TOptions = {
        classes?: {
            header?: string | ((Node) => string)
            headerSelected?: string
        }
        stepPadding?: number
    }
    export type THeaderView<NodeType extends Node> = (
        state: State<NodeType>,
        node: NodeType,
        root: NodeType,
    ) => VirtualDOM

    export type TDropAreaView<NodeType extends Node> = (
        state: State<NodeType>,
        parent: NodeType,
        children: NodeType[],
        insertIndex: number,
    ) => VirtualDOM

    export class View<NodeType extends Node> implements VirtualDOM {
        static staticOptions: TOptions = {
            classes: {
                header: () => 'd-flex align-items-baseline fv-tree-header ',
                headerSelected: 'fv-tree-selected fv-text-focus',
            },
            stepPadding: 15,
        }

        public readonly state: State<NodeType>
        public readonly tag = 'div'
        public readonly children: [VirtualDOM]

        public readonly contextMenu$ = new Subject<{
            event: MouseEvent
            data: { state: State<Node>; node: NodeType; root: NodeType }
        }>()

        private readonly toggledNode$ = new Subject<string>()
        private readonly subscriptions = new Array<Subscription>()

        private readonly headerView: THeaderView<NodeType>
        private readonly dropAreaView: TDropAreaView<NodeType>
        private readonly options: TOptions
        private readonly headerClassesFct: (n: NodeType) => string

        connectedCallback = (elem) => {
            elem.subscriptions = elem.subscriptions.concat(this.subscriptions)
        }

        constructor({
            state,
            headerView,
            dropAreaView,
            options,
            ...rest
        }: {
            state: State<NodeType>
            headerView: THeaderView<NodeType>
            dropAreaView?: TDropAreaView<NodeType>
            options?: TOptions
            [_k: string]: unknown
        }) {
            Object.assign(this, rest)
            this.options = Object.assign(View.staticOptions, options)
            this.headerClassesFct =
                typeof this.options.classes.header == 'string'
                    ? () => this.options.classes.header as string
                    : this.options.classes.header

            this.state = state
            this.headerView = headerView
            this.dropAreaView = dropAreaView

            const content$ = child$(this.state.root$, (root) => {
                const rootView = this.nodeView(root, root, 0)
                rootView.connectedCallback = (elem) =>
                    this.onConnectedCallbackRoot(elem)
                return rootView
            })

            this.children = [content$]
        }

        private onConnectedCallbackRoot(elem) {
            elem.subscriptions.push(
                this.toggledNode$.subscribe((nodeId) => {
                    const actualValues = this.state.expandedNodes$.getValue()
                    if (actualValues.includes(nodeId)) {
                        this.state.expandedNodes$.next(
                            actualValues.filter((n) => n != nodeId),
                        )
                        return
                    }
                    this.state.expandedNodes$.next([...actualValues, nodeId])
                }),
            )
        }

        protected nodeView(
            root: NodeType,
            node: NodeType,
            depth: number,
        ): VirtualDOM {
            const isLeaf = node.children == undefined
            const nodeExpanded$ = this.state.expandedNodes$.pipe(
                map((expandedNodes) => expandedNodes.indexOf(node.id) > -1),
                tap((expanded) => {
                    if (expanded) {
                        this.state.getChildren(node)
                    }
                    return expanded // expanded ? this.state.getChildren(node) : {}
                }),
            )
            const rowView = this.rowView(root, node, nodeExpanded$, depth)
            if (rowView == undefined) return undefined

            return {
                id: 'node-' + node.id,
                style: { position: 'relative' },
                children: [
                    rowView,
                    this.expandedContent$(root, node, nodeExpanded$, depth),
                    this.arianeLine(depth, isLeaf),
                ],
            }
        }

        protected rowView(
            root: NodeType,
            node: NodeType,
            nodeExpanded$: Observable<boolean>,
            depth: number,
        ) {
            const space = this.leftSpacing(depth)
            const itemHeader = this.headerView(this.state, node, root)
            if (itemHeader == undefined) return undefined

            const class$ = attr$(
                this.state.selectedNode$,
                (selected: NodeType) =>
                    selected != undefined && selected === node
                        ? this.options.classes.headerSelected
                        : '',
                {
                    wrapper: (d) => this.headerClassesFct(node) + ' ' + d,
                    untilFirst: this.headerClassesFct(node),
                },
            )

            return {
                class: class$,
                children: [
                    { style: { 'min-width': space + 'px' } },
                    this.handleView(node, nodeExpanded$),
                    itemHeader,
                ],
                oncontextmenu: (event) => {
                    event.preventDefault()
                    this.state.selectedNode$.next(node)
                    this.contextMenu$.next({
                        event,
                        data: { node, state: this.state, root },
                    })
                },
                onclick: (_: MouseEvent) => {
                    this.state.selectedNode$.next(node)
                    if (!this.state.expandedNodes$.getValue().includes(node.id))
                        this.toggledNode$.next(node.id)
                },
            }
        }

        protected arianeLine(depth: number, isLeaf: boolean) {
            const space = this.leftSpacing(depth)
            return {
                class: 'fv-tree-arianeLine',
                style: {
                    position: 'absolute',
                    top: `${this.options.stepPadding}px`,
                    left: space + 'px',
                    'border-left': isLeaf ? 'none' : 'solid',
                    'border-left-width': '1px',
                    height: `calc(100% - ${this.options.stepPadding}px)`,
                },
            }
        }

        protected handleView(
            node: NodeType,
            nodeExpanded$: Observable<boolean>,
        ) {
            const isLeaf = node.children == undefined

            return isLeaf
                ? {}
                : {
                      tag: 'i',
                      class: attr$(
                          nodeExpanded$,
                          (expanded): string =>
                              expanded
                                  ? 'fa-caret-down fv-tree-expanded'
                                  : 'fa-caret-right',
                          {
                              wrapper: (d) => 'pr-2 fas fv-tree-expand ' + d,
                          },
                      ),
                      onclick: (event) => {
                          this.toggledNode$.next(node.id)
                          event.stopPropagation()
                      },
                  }
        }

        protected leftSpacing(depth: number) {
            return depth * this.options.stepPadding + 5
        }

        protected expandedContent$(
            root: NodeType,
            node: NodeType,
            nodeExpanded$: Observable<boolean>,
            depth: number,
        ) {
            const children$ = this.state.getChildren$(node).pipe(
                filter((d) => d != undefined),
                distinct(),
            )
            return child$(children$, (children) => {
                const filteredViews = children
                    .map((child) => {
                        return {
                            child,
                            view: this.nodeView(root, child, depth + 1),
                        }
                    })
                    .filter(({ view }) => view != undefined)
                const filteredChildren = filteredViews.map(({ child }) => child)

                return {
                    class: attr$(nodeExpanded$, (expanded) =>
                        expanded ? 'd-block' : 'd-none',
                    ),
                    children: filteredViews
                        .map(({ view }, i) => {
                            let dropView = (insertIndex) =>
                                this.dropAreaView &&
                                this.dropAreaView(
                                    this.state,
                                    node,
                                    filteredChildren,
                                    insertIndex,
                                )
                            return [
                                dropView(i),
                                view,
                                i == children.length - 1 &&
                                    dropView(children.length),
                            ]
                        })
                        .flat()
                        .filter((d) => d != undefined),
                }
            })
        }
    }
}
