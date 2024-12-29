const userModel = require('../models/User');
const bcrypt = require("bcryptjs");
const { ObjectId } = require('mongodb');

exports.getAll = async (body, res) => {
    try {
        let data = await userModel.find();
        return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.searchUser = async (body, res) => {
    try {
        let page = parseInt(body.page || 1);
        let limit = parseInt(body.limit || 10);
        let query = {};
        if (body.searchQuery) {
            query['$or'] = [
                {'name': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'mobile': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
                {'email': {$regex: new RegExp(body.searchQuery.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i")}},
            ]
        }
        let data = await userModel.find(query).skip((page - 1) * limit).limit(parseInt(limit));
        const totalUsers = await userModel.countDocuments(query);
        return res({status: 200, data, total: totalUsers, pages: Math.ceil(totalUsers / limit), currentPage: page});
        // return res({status: 200, data});
    } catch (err) {
        return res({status: 500, message: "Something went wrong"});
    }
}

exports.addUser = async (body, res) => {
    try {
        let errorArray = [];
        const oldMobile = await userModel.findOne({
            mobile: {$regex: new RegExp(`^${body.mobile.trim()}$`), "$options": "i"}
        });
        if (oldMobile)
            errorArray.push('Mobile already exists')

        const oldEmail = await userModel.findOne({email: {$regex: new RegExp(`^${body.email.trim()}$`), "$options": "i"}});
        if (oldEmail)
            errorArray.push('Email already exists')

        if (errorArray.length) {
            return res({ status: 400, error: errorArray })
        }

        body.password = await bcrypt.hash(body.password, 10);

        let userData = await userModel.insertMany(body);
        return res({status: 200, message: userData});
    } catch (err) {
        console.log(err)
        return res({status: 500, message: err});
    }
}

exports.userUpdate = async (id, body, res) => {
    try {
        let errorArray = [];
        const oldMobile = await userModel.findOne({ mobile: {$regex: new RegExp(`^${body.mobile.trim()}$`), "$options": "i" }});
        if (body.mobile !== undefined && oldMobile !== null && oldMobile._id.toString() !== id) {
            errorArray.push('Mobile already exists')
            // return res({ status: 400, message: 'Mobile already exists' });
        }
        const oldEmail = await userModel.findOne({ email: {$regex: new RegExp(`^${body.email.trim()}$`), "$options": "i"}});
        if (body.email !== undefined && body.email !== null && oldEmail !== null && oldEmail._id.toString() !== id) {
            errorArray.push('Email already exists')
            // return res({ status: 400, message: 'Email already exists' });
        }
        if (errorArray.length) {
            return res({ status: 400, error: errorArray, })
        }
        let user = await userModel.updateOne({ _id: new ObjectId(id) }, { $set: body });
        return res({ status: 200, message: user });
    } catch (err) {
        console.log(err)
        return res({ status: 500, message: err });
    }
}

exports.getUser = async (id, res) => {
    try {
        const data = await userModel.findOne({_id: new ObjectId(id)}, {password: 0, token: 0});
        data.rewards = [
            {"title": "Redeemed Points", "description": "Redeemed Points Confirmation", "count": data.redeemedPoints},
            {"title": "Earned Cash Reward", "description": "Earned Cash Reward Confirmation", "count": data.cash},
        ];
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}

exports.deleteUser = async (id, res) => {
    try {
        const data = await userModel.deleteOne({_id: new ObjectId(id)});
        return res({status: 200, data: data})
    } catch (err) {
        return res({status: 500, message: err})
    }
}
