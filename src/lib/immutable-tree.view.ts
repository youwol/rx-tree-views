import { attr$, child$, VirtualDOM } from '@youwol/flux-view'
import {
    BehaviorSubject,
    Observable,
    of,
    ReplaySubject,
    Subject,
    Subscription,
} from 'rxjs'
import { distinct, filter, map, scan, take, tap } from 'rxjs/operators'

export namespace ImmutableTree {
    export function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
            /[xy]/g,
            function (c) {
                const r = (Math.random() * 16) | 0,
                    v = c == 'x' ? r : (r & 0x3) | 0x8
                return v.toString(16)
            },
        )
    }

    /*
    Node are immutable hierarchical data structure
    */
    export class Node {
        public children?: Array<Node> | Observable<Array<Node>>
        public readonly factory: new (...args: unknown[]) => Node
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
            if (!this.children || this.children instanceof Observable) {
                throw Error(
                    'Children are not defined or have no been resolved yet',
                )
            }
            return this.children
        }

        resolveChildren(): Observable<Array<Node>> {
            if (!this.children) {
                return
            }
            if (Array.isArray(this.children)) {
                return of(this.children)
            }

            return this.children.pipe(
                take(1),
                tap((children: Array<Node>) => {
                    if (!children) {
                        return
                    }
                    this.children = children
                }),
                map((children) => children),
            )
        }
    }

    export function find(node: Node, fct) {
        if (fct(node)) {
            return node
        }
        if (!node.children || node.children instanceof Observable) {
            return undefined
        }
        for (const child of node.children) {
            const target = find(child, fct)
            if (target) {
                return target
            }
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
            public readonly metadata: Record<string, unknown> = undefined,
        ) {}

        execute(
            tree: State<NodeType>,
            _emitUpdate = true,
            _updatePropagationFct = (_old) => ({}),
        ) {
            /*no op*/
        }
    }

    export class AddChildCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly parentNode: NodeType,
            public readonly childNode: NodeType,
            public readonly metadata: Record<string, unknown> = undefined,
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

    export class RemoveNodeCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly parentNode: NodeType,
            public readonly removedNode: NodeType,
            public readonly metadata: Record<string, unknown> = undefined,
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
            public readonly metadata: Record<string, unknown> = undefined,
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

    export class ReplaceAttributesCommand<NodeType extends Node>
        implements Command<NodeType>
    {
        constructor(
            public readonly node: NodeType,
            public readonly attributes: { [key: string]: unknown },
            public readonly metadata: Record<string, unknown> = undefined,
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
        public readonly children$ = new Map<Node, ReplaySubject<Array<Node>>>()
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
                            if (this.currentIndex < this.historic.length - 1) {
                                this.historic = this.historic.slice(
                                    0,
                                    this.currentIndex + 1,
                                )
                            }
                            this.historic.push(root)
                            this.currentIndex = this.historic.length - 1
                            return
                        }
                        this.currentIndex = indexHistory
                    }),
            )
            if (rootNode) {
                this.reset(rootNode, emitUpdate)
            }
        }

        reset(root: NodeType, emitUpdate = true) {
            this.parents = {}
            this.historic = []
            this.currentIndex = 0
            this.setParentRec(root, undefined)
            this.root = root
            const update = new Updates([], [], this.root, new InitCommand(root))
            this.tmpUpdates.push(update)

            if (emitUpdate) {
                this.emitUpdate()
            }
        }

        unsubscribe() {
            this.subscriptions.unsubscribe()
        }

        getParent(nodeId): NodeType {
            return this.parents[nodeId]
        }

        reducePath(
            start: string | NodeType,
            extractFct: (NodeType) => unknown,
        ): Array<unknown> {
            if (start == undefined) {
                return []
            }

            const node = start instanceof Node ? start : this.getNode(start)

            return this.reducePath(this.getParent(node.id), extractFct).concat([
                extractFct(node),
            ])
        }

        getChildren(
            node: NodeType,
            then?: (node: NodeType, children: Array<NodeType>) => void,
        ) {
            if (!node.children) {
                return
            }

            if (Array.isArray(node.children)) {
                this.getChildren$(node).next(node.children)
                return
            }
            this.subscriptions.add(
                node
                    .resolveChildren()
                    .subscribe((children: Array<NodeType>) => {
                        if (!children) {
                            return
                        }
                        children.forEach((child) =>
                            this.setParentRec(child, node),
                        )
                        this.getChildren$(node).next(children)
                        then && then(node, children)
                    }),
            )
        }

        getChildren$(node: Node) {
            if (!this.children$.has(node)) {
                this.children$.set(node, new ReplaySubject(1))
            }

            return this.children$.get(node)
        }

        undo() {
            if (this.currentIndex == 0) {
                return
            }
            this.root$.next(this.historic[this.currentIndex - 1])
        }

        redo() {
            if (this.currentIndex == this.historic.length - 1) {
                return
            }
            this.root$.next(this.historic[this.currentIndex + 1])
        }

        getNode<T = NodeType>(id): T {
            if (id == this.root.id) {
                return this.root as unknown as T
            }

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
            const parentNode =
                parent instanceof Node ? parent : this.getNode(parent)

            if (!parentNode) {
                throw Error('Can not find the parent to add the child')
            }

            if (
                !parentNode.children ||
                parentNode.children instanceof Observable
            ) {
                throw Error(
                    'You can not add a child to a node not already resolved',
                )
            }

            const newChild = new childNode.factory({
                ...childNode,
                ...updatePropagationFct(childNode),
            }) as NodeType
            const newParent = new parentNode.factory({
                ...parentNode,
                ...{ children: parentNode.children.concat(newChild) },
                ...updatePropagationFct(parentNode),
            }) as NodeType

            newParent.children.forEach((child) =>
                this.setParentRec(child, newParent),
            )

            this.root = this.cloneTreeAndReplacedChild(
                parentNode,
                newParent,
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

        removeNode(
            target: string | NodeType,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: Record<string, unknown> = undefined,
        ) {
            const node = target instanceof Node ? target : this.getNode(target)

            if (!node) {
                throw Error('Can not find the node to remove')
            }

            const parentNode = this.parents[node.id]

            if (!parentNode) {
                throw Error('Can not find the parent of the node to remove')
            }

            if (
                !parentNode.children ||
                parentNode.children instanceof Observable
            ) {
                throw Error(
                    'You can not add a child to a node not already resolved',
                )
            }

            const newParent = new parentNode.factory({
                ...parentNode,
                ...{
                    children: parentNode.children.filter(
                        (child) => child.id != node.id,
                    ),
                },
            }) as NodeType

            delete this.parents[node.id]
            newParent.children &&
                newParent.children.forEach(
                    (c) => (this.parents[c.id] = newParent),
                )

            this.children$.has(node) && this.children$.delete(node)

            this.root = this.cloneTreeAndReplacedChild(
                parentNode,
                newParent,
                updatePropagationFct,
            )

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

        replaceNode(
            target: string | NodeType,
            newNode,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: Record<string, unknown> = undefined,
        ) {
            const oldNode =
                target instanceof Node ? target : this.getNode(target)

            if (!oldNode) {
                throw Error('Can not find the node to remove')
            }

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

        replaceAttributes(
            target: string | NodeType,
            newAttributes,
            emitUpdate = true,
            updatePropagationFct = (_old) => ({}),
            cmdMetadata: Record<string, unknown> = undefined,
        ) {
            const node = target instanceof Node ? target : this.getNode(target)

            if (!node) {
                throw Error('Can not find the node to remove')
            }

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

        private cloneTreeAndReplacedChild(
            oldChild: NodeType,
            newChild: NodeType,
            updatePropagationFct,
        ) {
            const oldParent = this.parents[oldChild.id]
            if (oldParent == undefined) {
                return newChild
            }

            if (
                !oldParent.children ||
                oldParent.children instanceof Observable
            ) {
                throw Error(
                    'You can not add a child to a node not already resolved',
                )
            }

            const newParent = new oldParent.factory({
                ...oldParent,
                ...{
                    children: oldParent.children.map((child) =>
                        child.id == oldChild.id ? newChild : child,
                    ),
                },
                ...updatePropagationFct(oldParent),
            }) as NodeType
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
    type TOptions = {
        classes?: {
            header?: string
            headerSelected?: string
        }
        stepPadding?: number
    }
    type THeaderView<NodeType extends Node> = (
        state: State<NodeType>,
        node: NodeType,
        root: NodeType,
    ) => VirtualDOM

    export class View<NodeType extends Node> implements VirtualDOM {
        static options: TOptions = {
            classes: {
                header: 'd-flex align-items-baseline fv-tree-header ',
                headerSelected: 'fv-tree-selected fv-text-focus',
            },
            stepPadding: 15,
        }

        public readonly state: State<NodeType>
        public readonly tag = 'div'
        public readonly children: [VirtualDOM]

        public readonly contextMenu$ = new Subject<{
            event: MouseEvent
            data: { state: State<NodeType>; node: NodeType; root: NodeType }
        }>()

        private readonly toggledNode$ = new Subject<string>()
        private readonly subscriptions = new Array<Subscription>()

        private readonly headerView: THeaderView<NodeType>
        private readonly options: TOptions

        connectedCallback = (elem) => {
            elem.subscriptions = elem.subscriptions.concat(this.subscriptions)
        }

        constructor({
            state,
            headerView,
            options,
            ...rest
        }: {
            state: State<NodeType>
            headerView: THeaderView<NodeType>
            options?: TOptions
            [_key: string]: unknown
        }) {
            Object.assign(this, rest)
            this.options = Object.assign(View.options, options)

            this.state = state
            this.headerView = headerView

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
                this.toggledNode$
                    .pipe(
                        scan(
                            (acc, nodeId) =>
                                acc.includes(nodeId)
                                    ? acc.filter((id) => id != nodeId)
                                    : acc.concat([nodeId]),
                            [],
                        ),
                    )
                    .subscribe((nodeIds) =>
                        this.state.expandedNodes$.next(nodeIds),
                    ),
            )
            this.state.expandedNodes$
                .getValue()
                .forEach((nodeId) => this.toggledNode$.next(nodeId))
        }

        protected nodeView(
            root: NodeType,
            node: NodeType,
            depth: number,
        ): VirtualDOM {
            const isLeaf = node.children == undefined
            const nodeExpanded$ = this.state.expandedNodes$.pipe(
                map((expandedNodes) => expandedNodes.indexOf(node.id) > -1),
                tap((expanded) =>
                    expanded ? this.state.getChildren(node) : {},
                ),
            )

            return {
                id: 'node-' + node.id,
                style: { position: 'relative' },
                children: [
                    this.rowView(root, node, nodeExpanded$, depth),
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

            const class$ = attr$(
                this.state.selectedNode$,
                (selected) =>
                    selected != undefined && selected === node
                        ? this.options.classes.headerSelected
                        : '',
                {
                    wrapper: (d) => this.options.classes.header + ' ' + d,
                    untilFirst: this.options.classes.header,
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
                    if (
                        !this.state.expandedNodes$.getValue().includes(node.id)
                    ) {
                        this.toggledNode$.next(node.id)
                    }
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
                          (expanded) =>
                              expanded
                                  ? 'fa-caret-down fv-tree-expanded'
                                  : 'fa-caret-right',
                          { wrapper: (d) => 'pr-2 fas fv-tree-expand ' + d },
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
            return child$(children$, (children) => ({
                class: attr$(nodeExpanded$, (expanded) =>
                    expanded ? 'd-block' : 'd-none',
                ),
                children: children.map((child) =>
                    this.nodeView(root, child, depth + 1),
                ),
            }))
        }
    }
}
