import { Address, beginCell,  Cell, Builder, BitString, Dictionary, Contract, contractAddress, ContractProvider, Sender, SendMode, toNano } from '@ton/core';
import { Op, Params } from "./Constants";
import { inherits } from 'util';

export type OrderConfig = {
    multisig: Address,
    salt: number
};

function arrayToCell(arr: Array<Address>): Dictionary<number, Address> {
    let dict = Dictionary.empty(Dictionary.Keys.Uint(8), Dictionary.Values.Address());
    for (let i = 0; i < arr.length; i++) {
        dict.set(i, arr[i]);
    }
    return dict;
}

function cellToArray(addrDict: Cell | null) : Array<Address>  {
    let resArr: Array<Address> = [];
    if(addrDict !== null) {
        const dict = Dictionary.loadDirect(Dictionary.Keys.Uint(8), Dictionary.Values.Address(), addrDict);
        resArr = dict.values();
    }
    return resArr;
}

export function orderConfigToCell(config: OrderConfig): Cell {
    const initState = beginCell().storeAddress(config.multisig).storeUint(config.salt, Params.bitsize.salt);
    return beginCell()
        .storeRef(initState)
        .endCell();
}

export class Order implements Contract {
    constructor(readonly address: Address,
                readonly init?: { code: Cell, data: Cell },
                readonly configuration?: OrderConfig) {}
    
    static createFromAddress(address: Address) {
        return new Order(address);
    }

    static createFromConfig(config: OrderConfig, code: Cell, workchain = 0) {
        const data = orderConfigToCell(config);
        const init = { code, data };

        return new Order(contractAddress(workchain, init), init, config);
    }

    static initMessage(
        signers: Array<Address>,
        expiration_date: number,
        opaque_order: Cell,
        threshold: number = 1,
        signer_idx: number = 0,
        query_id: number | bigint = 0) 
    {
        const msgBody = beginCell()
            .storeUint(Op.order.approve, Params.bitsize.op)
            .storeUint(query_id, Params.bitsize.queryId)
            .storeUint(threshold, Params.bitsize.signerIndex)
            .storeRef(beginCell().storeDictDirect(arrayToCell(signers)))
            .storeUint(expiration_date, Params.bitsize.time)
            .storeUint(signer_idx, Params.bitsize.signerIndex)
            .storeRef(opaque_order);


       return msgBody.endCell();
    }

    async sendDeploy(provider: ContractProvider,
        via: Sender,
        value: bigint,
        threshold: number = 1,
        signers: Array<Address>,
        expiration_date: number,
        order: Cell,
        signer_idx: number = 0,
        query_id : number | bigint = 0

    ) {
    
       await provider.internal(via, {
           value,
           sendMode: SendMode.PAY_GAS_SEPARATELY,
           body: Order.initMessage(signers, expiration_date, order, threshold, signer_idx, query_id)  // 使用 opaque_order 和 order_hash
        });
    }

    async sendApprove(provider: ContractProvider, via: Sender, signer_idx: number, value: bigint = toNano('0.1'), query_id: number | bigint = 0) {
        await provider.internal(via, {
            value,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell()
                .storeUint(Op.order.approve, Params.bitsize.op)
                .storeUint(query_id, Params.bitsize.queryId)
                .storeUint(signer_idx, Params.bitsize.signerIndex)
                .endCell()
        });
    }


    async getOrderData(provider: ContractProvider) {
       /*
       (slice multisig, int order_seqno, int threshold,
                     int sent_for_execution?, cell signers,
                     int approvals, int approvals_num, int expiration_date,
                     cell order)
       */
    const { stack } = await provider.get("get_order_data", []);
    const multisig = stack.readAddress();
    const salt = stack.readNumberOpt();
    const threshold = stack.readNumberOpt();
    const signers = cellToArray(stack.readCellOpt());
    const approvals_mask = stack.readBigNumberOpt();
    const approvals_num = stack.readNumberOpt();
    const expiration_date = stack.readBigNumberOpt();
    const order_hash = stack.readBigNumber();
    const init_sender = stack.readAddress();
             
    return {
        inited: threshold !== null,
        multisig,
        salt,
        threshold,
        signers,
        approvals_mask,
        approvals_num,
        expiration_date,
        order_hash,
        init_sender
    };
    }
}
