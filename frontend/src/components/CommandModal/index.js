import React, { useState, useEffect, useRef } from "react";

import * as Yup from "yup";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";

import { makeStyles } from "@material-ui/core/styles";
import { green } from "@material-ui/core/colors";
import Button from "@material-ui/core/Button";
import TextField from "@material-ui/core/TextField";
import Dialog from "@material-ui/core/Dialog";
import DialogActions from "@material-ui/core/DialogActions";
import DialogContent from "@material-ui/core/DialogContent";
import DialogTitle from "@material-ui/core/DialogTitle";
import CircularProgress from "@material-ui/core/CircularProgress";
import QueueSelectSingle from "../QueueSelectSingle";
import UserSelect from "../UserSelect";
import FileBase64 from 'react-file-base64';
import Select from "@material-ui/core/Select";
import MenuItem from "@material-ui/core/MenuItem";
import FormControl from "@material-ui/core/FormControl";
import InputLabel from "@material-ui/core/InputLabel";

import { i18n } from "../../translate/i18n";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import CommandTypeSelect from "../CommandTypeSelect";

const useStyles = makeStyles(theme => ({
	root: {
		display: "flex",
		flexWrap: "wrap",
	},
	multFieldLine: {
		display: "flex",
		"& > *:not(:last-child)": {
			marginRight: theme.spacing(1),
		},
	},

	btnWrapper: {
		position: "relative",
	},

	buttonProgress: {
		color: green[500],
		position: "absolute",
		top: "50%",
		left: "50%",
		marginTop: -12,
		marginLeft: -12,
	},
	formControl: {
		margin: theme.spacing(1),
		minWidth: 120,
	},
}));

const CommandSchema = Yup.object().shape({
	commandBot: Yup.string()
		.min(1, "Muito curto!")
		.max(50, "Muito longo!")
		.required("Obrigatório"),
	commandType: Yup.number(),
});

function FileUpload(props) {
	const { field, form } = props;

	const handleChange = (e) => {
		const file = e.currentTarget.files[0];
		const reader = new FileReader();
		const imgTag = document.getElementById("myimage");
		imgTag.title = file.name;

		reader.onload = function (event) {
			imgTag.src = event.target.result;
			form.setFieldValue("arquivo", event.target.result);
		};
		reader.readAsDataURL(file);

		//form.setFieldValue(field.name, file);


	};

	return (
		<div>
			<input name="arquivoFile" type={'file'} onChange={(o) => handleChange(o)} className={'form-control'} />
			<img src={''} alt="" id={'myimage'} />
		</div>
	);
}

const CommandModal = ({ open, onClose, commandId }) => {
	const classes = useStyles();


	const initialState = {
		commandBot: "",
		commandType: "",
		descriptionBot: "",
		showMessage: "",
		userId: null,
		queueId: null,
		arquivo: ""
	};

	const [selectedCommandTypeId, setSelectedCommandTypeId] = useState("");
	const [showFields, setShowFields] = useState({ queues: false, users: false, message: false, descriptionBot: false, commandType: "" });
	const [command, setCommand] = useState(initialState);
	const greetingRef = useRef();



	useEffect(() => {
		const fetchCommand = async () => {
			setShowFields({ queues: false, users: false, message: false, descriptionBot: false, commandType: "" });
			//setSelectedCommandTypeId("");
			if (!commandId) return;
			try {
				const { data } = await api.get(`/bot/${commandId}`);
				setCommand(prevState => {
					return { ...prevState, ...data };
				});

				switch (data.commandType) {
					case 1:
						setShowFields({ queues: false, users: false, message: true, descriptionBot: true, commandType: data.commandType });
						break;
					case 2:
						setShowFields({ queues: false, users: false, message: false, descriptionBot: true, commandType: data.commandType });
						break;
					case 3:
						setShowFields({ queues: true, users: false, message: true, descriptionBot: false, commandType: data.commandType });
						break;
					case 4:
						setShowFields({ queues: false, users: true, message: true, descriptionBot: false, commandType: data.commandType });
						break;
				}
			} catch (err) {
				toastError(err);
			}
		};

		fetchCommand();
	}, [commandId, open]);

	const handleClose = () => {
		onClose();
		setCommand(initialState);
	};

	const handleSaveCommand = async values => {
		const commandData = { ...values };
		try {
			commandData.commandType = showFields.commandType;

			if (commandId) {
				await api.put(`/bot/${commandId}`, commandData);
			} else {
				await api.post("/bot", commandData);
			}
			toast.success(i18n.t("botModal.success"));
		} catch (err) {
			toastError(err);
		}
		handleClose();
	};

	return (
		<div className={classes.root}>
			<Dialog
				open={open}
				onClose={handleClose}
				maxWidth="xs"
				fullWidth
				scroll="paper"
			>
				<DialogTitle id="form-dialog-title">
					{commandId
						? `${i18n.t("botModal.title.edit")}`
						: `${i18n.t("botModal.title.add")}`}
				</DialogTitle>
				<Formik
					initialValues={command}
					enableReinitialize={true}
					validationSchema={CommandSchema}
					onSubmit={(values, actions) => {
						setTimeout(() => {
							//values.arquivo = getBase64File(values.arquivoUpload);s
							console.log("DADOS ENVIADO => ", values);
							handleSaveCommand(values);
							actions.setSubmitting(false);
						}, 400);
					}}
				>
					{({ touched, errors, isSubmitting }) => (
						<Form>
							<DialogContent dividers>
								<div className={classes.multFieldLine}>
									<Field
										as={TextField}
										label={i18n.t("botModal.form.commandBot")}
										autoFocus
										name="commandBot"
										error={touched.commandBot && Boolean(errors.commandBot)}
										helperText={touched.commandBot && errors.commandBot}
										variant="outlined"
										margin="dense"
										fullWidth
									/>
									<FormControl
										variant="outlined"
										className={classes.FormControl}
										margin="dense"
										fullWidth
									>
										<InputLabel>
											Tempo
										</InputLabel>
										<Field
											as={Select}
											label="Tempo"
											name="time"
										>
											<MenuItem key="0" value="5000">
												5 segundos
											</MenuItem>
											<MenuItem key="1" value="10000">
												10 segundos
											</MenuItem>
											<MenuItem key="2" value="20000">
												20 segundos
											</MenuItem>
											<MenuItem key="3" value="30000">
												30 segundos
											</MenuItem>
											<MenuItem key="4" value="40000">
												40 segundos
											</MenuItem>
											<MenuItem key="5" value="50000">
												50 segundos
											</MenuItem>
											<MenuItem key="6" value="60000">
												60 segundos
											</MenuItem>
										</Field>


									</FormControl>

									<CommandTypeSelect
										selectedCommandId={showFields.commandType}
										onChange={values => setShowFields(values)}
									/>
								</div>
								{/* {showFields.descriptionBot && <Field
									as={TextField}
									label={i18n.t("botModal.form.descriptionBot")}
									name="descriptionBot"
									error={touched.descriptionBot && Boolean(errors.descriptionBot)}
									helperText={touched.descriptionBot && errors.descriptionBot}
									variant="outlined"
									margin="dense"
									fullWidth
								/>} */}
								{showFields.users && <UserSelect />}
								<QueueSelectSingle />
								{showFields.message && <Field
									as={TextField}
									label={i18n.t("botModal.form.showMessage")}
									name="showMessage"
									multiline
									inputRef={greetingRef}
									rows={5}
									fullWidth
									error={touched.showMessage && Boolean(errors.showMessage)}
									helperText={touched.showMessage && errors.showMessage}
									variant="outlined"
									margin="dense"
								/>}

								<Field
									name="arquivoUpload"
									component={FileUpload}
								/>
							</DialogContent>
							<p style={{ textAlign: 'center' }}>Atenção: limite máximo para arquivos - 50MB</p>
							<p>Link para copiar emoji para colocar na mensagem: <a target="_blank" href="https://emojiterra.com/pt/search/ios/">Clique aqui</a></p>
							<DialogActions>
								<Button
									onClick={handleClose}
									color="secondary"
									disabled={isSubmitting}
									variant="outlined"
								>
									{i18n.t("botModal.buttons.cancel")}
								</Button>
								<Button
									type="submit"
									color="primary"
									disabled={isSubmitting}
									variant="contained"
									className={classes.btnWrapper}
								>
									{commandId
										? `${i18n.t("botModal.buttons.okEdit")}`
										: `${i18n.t("botModal.buttons.okAdd")}`}
									{isSubmitting && (
										<CircularProgress
											size={24}
											className={classes.buttonProgress}
										/>
									)}
								</Button>
							</DialogActions>
						</Form>
					)}
				</Formik>
			</Dialog>
		</div>
	);
};

export default CommandModal;
