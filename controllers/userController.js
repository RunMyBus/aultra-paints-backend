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

exports.addUser = async (body, res) => {
    try {
        let errorArray = [];
        const oldEmail = await userModel.findOne({
            email: {
                $regex: new RegExp(`^${body.email.trim()}$`),
                "$options": "i"
            }
        });
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
