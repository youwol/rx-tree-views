import { BehaviorSubject, ReplaySubject, Subject } from "rxjs"
import { ImmutableTree } from "../index"

import { delay, filter, share, skip, take } from "rxjs/operators";
import { attr$, child$, render } from "@youwol/flux-view";


import * as Match from 'rxjs-spy/cjs/match';
import { create, SnapshotPlugin } from "rxjs-spy";
import { tag } from "rxjs-spy/cjs/operators";

const spy = create();

function getOpenSubscriptions(){

    var snapshotPlugin = spy.find(SnapshotPlugin);
    
    var snapshot = snapshotPlugin['snapshotAll']();
    var matched = Array
        .from(snapshot.observables.values())
        .filter(function (observableSnapshot) { return Match.matches(observableSnapshot['observable'], /.+/); });

    return matched.map( (match )=> {
        let keys = match.subscriptions.keys()
        let openSubscriptions = Array.from(keys)
        .filter( element => {
            return !element.closed
        });
        return { tag: match.tag, openSubscriptions }
    }).reduce( (acc,e) => ({...acc, ...{[e.tag]:e.openSubscriptions.length}}) , {}) as any

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
    constructor({ id, name, children }) { super({ id, name, children, faClass:'fa-hdd'}) }
}
class FolderNode extends Node {
    constructor({ id, name, children }) { super({ id, name, children, faClass:'fa-folder' }) }
}
class FileNode extends Node {
    constructor({ id, name }) { super({ id, name, children: undefined, faClass:'fa-file'}) }
}

let parse = (id, node) => {

    let factory = { drive: DriveNode, folder: FolderNode, file: FileNode }
    let children = node.children && Object.entries(node.children).map(([id, child]) => {
        return parse(id, child)
    })
    return new factory[node.type]({ id, name: node.name, children })
}


test('subscriptions are closed', (done) => {

    spy.flush();
    let data = {
        name: 'Drive', type: 'drive',
        children: {
            folderA: {
                name: 'FolderA', type: 'folder',
                children: {
                    file1: { name: 'File1', type: 'file' },
                    file2: { name: 'File2', type: 'file' }
                }
            }
        }
    }
    
    let rootNode =  parse('drive', data)
    let state = new ImmutableTree.State<Node>({ rootNode })
    let classSubject = new BehaviorSubject<string>('toto')
    let childSubject = new ReplaySubject<{id:string, tag: string}>(1)
    let headerView = (state, node) => {
        return {
            id: `header-${node.id}`,
            innerText: node.name, 
            class: attr$( 
                classSubject.pipe(tag('class_'+node.id)), 
                (d) => d ,
                {wrapper: (d) => 'test-header '+d}
            ),
            children:[
                child$( 
                    childSubject.pipe(filter( ({id}) => id==node.id), tag('child_'+node.id)), 
                    (d) => ({
                        class: attr$( classSubject.pipe(tag('class_child_'+node.id)),  (c) => c + " "+d.tag ),
                        innerText:'child '+d})
                )
            ]

        }
    }
    state.root$.pipe(
        take(1)
    ).subscribe( root => {
        expect(root).toBeInstanceOf(DriveNode)
        let children = root.children as Array<Node>
        expect( children.length).toEqual(1)
        state.addChild(root,new FolderNode({id:'folderB',name:'FolderB',children:[]}))
    })
    state.root$.pipe(
        take(1)
    ).subscribe( root => {
        expect(root === rootNode).toBeFalsy()
        expect(root).toBeInstanceOf(DriveNode)
        let children = root.children as Array<Node>
        expect(children.length).toEqual(2)

        let folder = state.getNode('folderB')
        expect(folder).toBeTruthy()
    })

    let view = new ImmutableTree.View<Node>({
        state, 
        headerView, 
        id:'tree-view',
        disconnectedCallback: () => state.unsubscribe()} as any)
    
    let div = render(view)
    document.body.appendChild( div )

    let root = document.getElementById("tree-view")
    expect(root).toBeTruthy()
    let headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(1)
    
    document.getElementById("header-drive").dispatchEvent(new MouseEvent('click',{button:0, bubbles: true}))
    headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(3) // drive +  folderA + folderB

    let handle = root.querySelector('.fv-tree-expand') 
    expect(handle).toBeTruthy()
    handle.dispatchEvent(new MouseEvent('click',{button:0, bubbles: true}))
    handle.dispatchEvent(new MouseEvent('click',{button:0, bubbles: true}))
    
    headers.forEach( header => {
        expect(header.classList.contains('toto')).toBeTruthy()
    })
    let subs = getOpenSubscriptions()
    expect(subs.class_drive).toEqual(1)
    expect(subs.class_folderA).toEqual(1)
    expect(subs.class_folderB).toEqual(1)
    expect(subs.child_drive).toEqual(1)
    expect(subs.child_folderA).toEqual(1)
    expect(subs.child_folderB).toEqual(1)

    classSubject.next('tutu')
    headers.forEach( header => {
        expect(header.classList.contains('tutu')).toBeTruthy()
    })

    state.removeNode('folderA')
    headers = root.querySelectorAll('.test-header')
    expect(headers.length).toEqual(2)
    subs = getOpenSubscriptions()
    expect(subs.class_folderA).toEqual(0)
    expect(subs.child_folderA).toEqual(0)

    childSubject.next({id:'folderB', tag:'first-test'})
    subs = getOpenSubscriptions()
    expect(subs.class_child_folderB).toEqual(1)
    let folderB = document.getElementById('header-folderB')
    let text = folderB.outerHTML
    let firstTestChild = document.getElementById('header-folderB').querySelector('.tutu.first-test')
    expect(firstTestChild).toBeTruthy()

    classSubject.next('tata')
    expect(firstTestChild.classList.contains('tata')).toBeTruthy()

    childSubject.next({id:'folderB', tag:'second-test'})
    let secondTestChild = document.getElementById('header-folderB').querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()

    subs = getOpenSubscriptions()
    expect(subs.class_child_folderB).toEqual(1)

    state.replaceAttributes('folderB', {name:'folderB-bis'})
    folderB = document.getElementById('header-folderB')
    expect(folderB).toBeTruthy()
    text = root.querySelector('#header-folderB')['innerText']
    expect(text).toEqual('folderB-bis')

    secondTestChild = folderB.querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()

    subs = getOpenSubscriptions()

    state.replaceNode('folderB', new FileNode({id:'new-file', name:'new file'}))
    let file = root.querySelector('#header-new-file')
    expect(file).toBeTruthy()

    subs = getOpenSubscriptions()
    let open = Object.entries(subs).filter( ([k,v]) => v > 0)
    expect(open.length).toEqual(4)

    state.undo()
    file = root.querySelector('#header-new-file')
    expect(file).toBeFalsy()
    folderB = document.getElementById('header-folderB')
    text = folderB.outerHTML
    secondTestChild = folderB.querySelector('.tata.second-test')
    expect(secondTestChild).toBeTruthy()
    subs = getOpenSubscriptions()
    
    expect(subs.class_drive).toEqual(1)
    expect(subs.class_folderA).toEqual(0)
    expect(subs['class_new-file']).toEqual(0)
    expect(subs.class_folderB).toEqual(1)
    expect(subs.child_drive).toEqual(1)
    expect(subs.child_folderA).toEqual(0)
    expect(subs.child_folderB).toEqual(1)
    expect(subs.class_child_folderB).toEqual(1)
    expect(subs['child_new-file']).toEqual(0)

    state.redo()
    file = root.querySelector('#header-new-file')
    expect(file).toBeTruthy()
    subs = getOpenSubscriptions()
    open = Object.entries(subs).filter( ([k,v]) => v > 0)
    expect(open.length).toEqual(4)
    expect(subs.class_drive).toEqual(1)
    expect(subs['class_new-file']).toEqual(1)
    expect(subs.child_drive).toEqual(1)
    expect(subs['child_new-file']).toEqual(1)

    let s = state['subscriptions']
    expect(s.closed).toEqual(false)
    root.remove()
    subs = getOpenSubscriptions()
    open = Object.entries(subs).filter( ([k,v]) => v > 0)
    expect(open.length).toEqual(0)

    expect(s.closed).toEqual(true)
    done()
})


test('async rendering', (done) => {

    spy.flush();
    let children$ = new Subject<Array<Node>>()
    let drive = new DriveNode(
        {
            id:'drive',
            name:'drive',
            children:[
                new FolderNode({id:'folderA', name:'FolderA', children:children$})
            ]
        }
    )
    
    let state = new ImmutableTree.State<Node>({ rootNode:drive, expandedNodes:['drive','folderA'] })
    let headerView = (state, node) => {
        return { id: `header-${node.id}`,  innerText: node.name}
    }
    let view = new ImmutableTree.View<Node>({state, headerView, id:'tree-view'} as any)
    
    let div = render(view)
    document.body.appendChild( div )

    let root = document.getElementById("tree-view")
    expect(root).toBeTruthy()
    let folderA = root.querySelector("#header-folderA")
    expect(folderA).toBeTruthy()
    
    children$.next([new FileNode({id:'fileA', name:'FileA'})])
    let fileA = root.querySelector("#header-fileA")
    expect(fileA).toBeTruthy()

    let children = drive.children[0].resolvedChildren()
    expect(children[0].id).toEqual('fileA')

    let path = state.reducePath(children[0], (node) => node.id)
    expect(path).toEqual(['drive','folderA','fileA'])

    view.contextMenu$.subscribe( ({data}) => {
        expect(data.node).toEqual(ImmutableTree.find( drive, (n) => n.id=='fileA'))
        done()
    })
    fileA.dispatchEvent(new MouseEvent('contextmenu',{button:2, bubbles: true}))
})


test('commands', (done) => {

    spy.flush();
    let children$ = new Subject<Array<Node>>()
    let drive = new DriveNode(
        {
            id:'drive',
            name:'drive',
            children:[]
        }
    )
    
    let state = new ImmutableTree.State<Node>({ rootNode:drive});
    (new ImmutableTree.InitCommand({})).execute(state)

    let addCmd = new ImmutableTree.AddChildCommand(drive, new FolderNode({id:'folderA', name:'FolderA', children:children$}))
    addCmd.execute(state)
    
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.id).toEqual('folderA')
        let cmd = new ImmutableTree.ReplaceAttributesCommand(folderA, {name:'FolderA-bis'})
        cmd.execute(state)
    })
    
    let uuid = ImmutableTree.uuid()
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.name).toEqual('FolderA-bis')
        let cmd = new ImmutableTree.ReplaceNodeCommand(folderA, new FileNode({id:uuid, name:'file'}))
        cmd.execute(state)
    })
    state.root$.pipe(take(1)).subscribe( root => {
        let file = ImmutableTree.find( root, (n) => n.id==uuid)
        expect(file.name).toEqual('file')
        let cmd = new ImmutableTree.RemoveNodeCommand(file, new FileNode({id:uuid,name:'file'}))
        cmd.execute(state)
    })
    state.root$.pipe(take(1)).subscribe( root => {
        let drive = ImmutableTree.find( root, (n) => n.id=='drive')
        expect(drive.children.length).toEqual(0)
    })
    state.undo()
    state.root$.pipe(take(1)).subscribe( root => {
        let file = ImmutableTree.find( root, (n) => n.id==uuid)
        expect(file.name).toEqual('file')
    }) 
    state.undo()
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.name).toEqual('FolderA-bis')
    })
    state.undo()
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.id).toEqual('folderA')
    })
    state.undo()
    state.root$.pipe(take(1)).subscribe( root => {
        expect(root.children).toEqual([])
    })
    state.undo()
    state.root$.pipe(take(1)).subscribe( root => {
        expect(root.children).toEqual([])
    })

    state.redo()
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.id).toEqual('folderA')
    })
    state.redo() 
    state.root$.pipe(take(1)).subscribe( root => {
        let folderA = ImmutableTree.find( root, (n) => n.id=='folderA')
        expect(folderA.name).toEqual('FolderA-bis')
    })
    state.redo()
    state.root$.pipe(take(1)).subscribe( root => {
        let file = ImmutableTree.find( root, (n) => n.id==uuid)
        expect(file.name).toEqual('file')
    })
    state.redo()
    state.root$.pipe(take(1)).subscribe( root => {
        let drive = ImmutableTree.find( root, (n) => n.id=='drive')
        expect(drive.children.length).toEqual(0)
    })
    state.redo()
    done()
})

test('errors', () => {

    spy.flush();
    
    let drive = new DriveNode(
        {
            id:'drive',
            name:'drive',
            children:[]
        }
    )
    
    let state = new ImmutableTree.State<Node>({ rootNode:drive}) 
    expect(state.getNode('tutu')).toEqual(undefined)
    let fct = () => state.addChild('tutu',new FileNode({id:'file', name:'file'}))
    expect(fct).toThrow()
    fct = () => state.removeNode('tutu')
    expect(fct).toThrow()
    fct = () => state.replaceAttributes('tutu', {})
    expect(fct).toThrow()
    fct = () => state.replaceNode('tutu', {})
    expect(fct).toThrow()
})